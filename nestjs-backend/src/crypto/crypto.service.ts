import { Injectable, Logger, HttpException, BadRequestException, NotFoundException, ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as crypto from "crypto";
import * as secretsUtils from "../common/utils/secrets";
import * as serviceAssertionUtils from "../common/utils/serviceAssertions";
import * as serviceContracts from "../common/utils/serviceContracts";
import * as securityLedger from "../common/utils/securityLedger";
import * as egressPolicy from "../common/utils/egressPolicy";

const RUST_CRYPTO_TIMEOUT_MS = Math.min(Math.max(Number.parseInt(process.env.RUST_CRYPTO_TIMEOUT_MS || "4000", 10) || 4000, 1000), 15000);
const RUST_CRYPTO_REQUIRE_SERVICE_ASSERTION = String(process.env.RUST_CRYPTO_REQUIRE_SERVICE_ASSERTION || "true").trim().toLowerCase() === "true";
const RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_COMMITMENT = String(process.env.RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_COMMITMENT || "service-crypto:commitment").trim() || "service-crypto:commitment";
const RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_VERIFY = String(process.env.RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_VERIFY || "service-crypto:verify").trim() || "service-crypto:verify";
const SERVICE_ASSERTION_ISSUER = String(process.env.SERVICE_ASSERTION_ISSUER || "filspresso-backend").trim();
const SERVICE_ASSERTION_SUBJECT = String(process.env.SERVICE_ASSERTION_SUBJECT || "backend").trim();
const SERVICE_ASSERTION_TTL_SECONDS = Math.min(Math.max(Number.parseInt(process.env.SERVICE_ASSERTION_TTL_SECONDS || "120", 10) || 120, 30), 600);
const THRESHOLD_DEFAULT_APPROVALS = Math.min(Math.max(Number.parseInt(process.env.CRYPTO_THRESHOLD_DEFAULT_APPROVALS || "2", 10) || 2, 2), 5);
const MPC_TRANSCRIPT_RATE_LIMIT_PER_MINUTE = Math.min(Math.max(Number.parseInt(process.env.MPC_TRANSCRIPT_RATE_LIMIT_PER_MINUTE || "30", 10) || 30, 5), 300);
const ZK_MAX_WITNESS_BYTES = Math.min(Math.max(Number.parseInt(process.env.ZK_MAX_WITNESS_BYTES || "65536", 10) || 65536, 1024), 5 * 1024 * 1024);

function stableSort(input: any): any {
  if (Array.isArray(input)) return input.map((item) => stableSort(item));
  if (!input || typeof input !== "object") return input;
  const ordered: any = {};
  for (const key of Object.keys(input).sort()) ordered[key] = stableSort(input[key]);
  return ordered;
}

function canonicalJson(value: any) {
  const safe = value && typeof value === "object" ? value : {};
  return JSON.stringify(stableSort(safe));
}

function sha3Hex(value: string) {
  return crypto.createHash("sha3-256").update(String(value || "")).digest("hex");
}

function toThresholdOperationResponse(row: any) {
  if (!row) return null;
  return {
    id: row.id, operationId: row.operation_id, operationType: row.operation_type, status: row.status,
    requiredApprovals: row.required_approvals, createdBy: row.created_by, executedBy: row.executed_by,
    approvedAt: row.approved_at, executedAt: row.executed_at, expiresAt: row.expires_at, payload: row.payload,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function buildProofHash({ verificationKeyHash, witnessHash, publicInputsCanonical }: any) {
  const publicInputsHash = sha3Hex(publicInputsCanonical);
  return sha3Hex(`${verificationKeyHash}|${witnessHash}|${publicInputsHash}`);
}

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly rustCryptoUrl: string;
  private readonly serviceAssertionPrivateKey: string;
  constructor(private readonly db: DatabaseService) {
    this.rustCryptoUrl = String(process.env.RUST_CRYPTO_URL || "http://localhost:8090").trim();
    this.serviceAssertionPrivateKey = secretsUtils.getEnvOrFile("SERVICE_ASSERTION_PRIVATE_KEY", { required: false, defaultValue: "" });

    try {
      egressPolicy.assertAllowedEgress(this.rustCryptoUrl, "RUST_CRYPTO_URL");
    } catch (e) {
      this.logger.warn(`Egress policy check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private createRustCryptoServiceAssertion(scope: string, operationId = "") {
    if (!this.serviceAssertionPrivateKey) return "";
    try {
      const issued = serviceAssertionUtils.issueServiceAssertion({
        privateKeyPem: this.serviceAssertionPrivateKey, issuer: SERVICE_ASSERTION_ISSUER,
        subject: SERVICE_ASSERTION_SUBJECT, scope, ttlSeconds: SERVICE_ASSERTION_TTL_SECONDS,
        operationId, keyPurpose: "service_assertion_signing", operationType: "issue_service_assertion",
      });
      return issued.token;
    } catch (error) {
      this.logger.warn(`Failed to issue rust-crypto service assertion: ${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
  }

  private buildRustCryptoUpstreamHeaders(scope: string, operationId = "") {
    const serviceAssertion = this.createRustCryptoServiceAssertion(scope, operationId);
    if (RUST_CRYPTO_REQUIRE_SERVICE_ASSERTION && !serviceAssertion) return null;
    const headers: Record<string, string> = { "x-service-name": "filspresso-backend", "x-operation-id": operationId };
    if (serviceAssertion) headers["x-service-assertion"] = serviceAssertion;
    return headers;
  }

  private async callRustCrypto(pathname: string, payload?: any, options: any = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUST_CRYPTO_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.rustCryptoUrl}${pathname}`, {
        method: payload ? "POST" : "GET",
        headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
      }
      return { ok: response.ok, status: response.status, data };
    } finally { clearTimeout(timeout); }
  }

  private signTranscriptPayload(payload: any) {
    if (!this.serviceAssertionPrivateKey) return "";
    try {
      const canonical = canonicalJson(payload);
      return crypto.sign(null, Buffer.from(canonical, "utf8"), crypto.createPrivateKey(this.serviceAssertionPrivateKey)).toString("base64url");
    } catch (error) {
      this.logger.warn(`Failed to sign MPC transcript payload: ${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
  }

  private async appendMpcTranscript(client: any, options: any) {
    const payload = options.payload && typeof options.payload === "object" ? options.payload : {};
    const signature = this.signTranscriptPayload(payload);
    await client.query(
      `INSERT INTO mpc_quorum_transcripts (session_id, participant_account_id, event_type, event_payload, signature)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [options.sessionId, options.participantAccountId || null, String(options.eventType || "mpc.event").slice(0, 48), JSON.stringify(payload), signature || null],
    );
  }

  private async enforceMpcTranscriptRateLimit(client: any, accountId: number) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM mpc_quorum_transcripts WHERE participant_account_id = $1 AND created_at > NOW() - INTERVAL '1 minute'`, [accountId]);
    const count = Number(result.rows[0]?.count || 0);
    if (count >= MPC_TRANSCRIPT_RATE_LIMIT_PER_MINUTE) throw new HttpException("MPC transcript rate limit exceeded", 429);
  }

  async getHealth() {
    try {
      const upstream = await this.callRustCrypto("/health");
      if (!upstream.ok) throw new ServiceUnavailableException({ error: "Rust crypto service unavailable", upstream });
      return { upstream: upstream.data || {} };
    } catch (error) { throw new ServiceUnavailableException({ error: "Failed to reach rust crypto service" }); }
  }

  async createCommitment(operationId: string, domain: string, payload?: string, payloadJson?: any) {
    if (!domain) throw new BadRequestException({ error: "domain is required" });
    const upstreamHeaders = this.buildRustCryptoUpstreamHeaders(RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_COMMITMENT, operationId);
    if (!upstreamHeaders) throw new ServiceUnavailableException({ error: "Rust crypto service assertion is required but could not be issued" });
    const commitmentRequest = { domain, payload, payload_json: payloadJson, operation_id: operationId };
    serviceContracts.assertServiceContract("rust_commitment_request_v1", commitmentRequest);
    const upstream = await this.callRustCrypto("/v1/commitment/sha3-256", commitmentRequest, { headers: upstreamHeaders });
    if (!upstream.ok) throw new ServiceUnavailableException({ error: "Rust crypto commitment failed", upstream: upstream.data });
    serviceContracts.assertServiceContract("rust_commitment_response_v1", upstream.data || {});
    return { operationId, commitment: upstream.data };
  }

  async verifyCommitment(operationId: string, domain: string, commitment: string, payload?: string, payloadJson?: any) {
    if (!domain || !commitment) throw new BadRequestException({ error: "domain and commitment_sha3_256 are required" });
    const upstreamHeaders = this.buildRustCryptoUpstreamHeaders(RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_VERIFY, operationId);
    if (!upstreamHeaders) throw new ServiceUnavailableException({ error: "Rust crypto service assertion is required but could not be issued" });
    const verifyRequest = { domain, payload, payload_json: payloadJson, commitment_sha3_256: commitment.toLowerCase(), operation_id: operationId };
    serviceContracts.assertServiceContract("rust_verify_request_v1", verifyRequest);
    const upstream = await this.callRustCrypto("/v1/verify/sha3-256", verifyRequest, { headers: upstreamHeaders });
    if (!upstream.ok) throw new ServiceUnavailableException({ error: "Rust crypto verification failed", upstream: upstream.data });
    serviceContracts.assertServiceContract("rust_verify_response_v1", upstream.data || {});
    return { operationId, verification: upstream.data };
  }

  // THRESHOLD OPERATIONS
  async createThresholdOperation(userId: number, operationId: string, body: any) {
    const operationType = String(body?.operation_type || body?.operationType || "").trim();
    if (!operationType) throw new BadRequestException({ error: "operation_type is required" });
    const requiredApprovals = Math.min(Math.max(Number.parseInt(body?.required_approvals || body?.requiredApprovals || THRESHOLD_DEFAULT_APPROVALS, 10) || THRESHOLD_DEFAULT_APPROVALS, 2), 5);
    const expiresInSeconds = Math.min(Math.max(Number.parseInt(body?.expires_in_seconds || body?.expiresInSeconds || "1800", 10) || 1800, 300), 86400);
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO threshold_operations (operation_id, operation_type, payload, required_approvals, created_by, expires_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, NOW() + (($6)::text || ' seconds')::interval) RETURNING *`,
        [operationId, operationType.slice(0, 64), JSON.stringify(payload), requiredApprovals, userId, expiresInSeconds],
      );
      const operationRow = inserted.rows[0];
      await client.query(`INSERT INTO threshold_operation_approvals (threshold_operation_id, account_id, operation_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [operationRow.id, userId, operationId]);
      const approvalCountResult = await client.query("SELECT COUNT(*)::int AS count FROM threshold_operation_approvals WHERE threshold_operation_id = $1", [operationRow.id]);
      const approvals = Number(approvalCountResult.rows[0]?.count || 0);

      let resolvedOperation = operationRow;
      if (approvals >= operationRow.required_approvals) {
        const approved = await client.query(`UPDATE threshold_operations SET status = 'approved', approved_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [operationRow.id]);
        resolvedOperation = approved.rows[0] || operationRow;
      }
      await client.query("COMMIT");
      return { status: "success", operation: toThresholdOperationResponse(resolvedOperation), approvals };
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }

  async approveThresholdOperation(userId: number, actionOperationId: string, thresholdOperationId: number) {
    if (!Number.isInteger(thresholdOperationId) || thresholdOperationId <= 0) throw new BadRequestException({ error: "Invalid threshold operation id" });
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const operationResult = await client.query("SELECT * FROM threshold_operations WHERE id = $1 FOR UPDATE", [thresholdOperationId]);
      const operationRow = operationResult.rows[0];
      if (!operationRow) { await client.query("ROLLBACK"); throw new NotFoundException({ error: "Threshold operation not found" }); }
      if (["cancelled", "rejected", "executed"].includes(String(operationRow.status))) { await client.query("ROLLBACK"); throw new ConflictException({ error: `Operation is already ${operationRow.status}` }); }
      if (operationRow.expires_at && new Date(operationRow.expires_at).getTime() <= Date.now()) {
        await client.query("UPDATE threshold_operations SET status = 'expired', updated_at = NOW() WHERE id = $1", [thresholdOperationId]);
        await client.query("COMMIT"); throw new ConflictException({ error: "Operation is expired" });
      }

      const approvalInsert = await client.query(
        `INSERT INTO threshold_operation_approvals (threshold_operation_id, account_id, operation_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
        [thresholdOperationId, userId, actionOperationId],
      );
      const approvalCountResult = await client.query("SELECT COUNT(*)::int AS count FROM threshold_operation_approvals WHERE threshold_operation_id = $1", [thresholdOperationId]);
      const approvals = Number(approvalCountResult.rows[0]?.count || 0);

      let resolvedOperation = operationRow;
      if (String(operationRow.status) === "pending" && approvals >= Number(operationRow.required_approvals || THRESHOLD_DEFAULT_APPROVALS)) {
        const approved = await client.query(`UPDATE threshold_operations SET status = 'approved', approved_at = COALESCE(approved_at, NOW()), updated_at = NOW() WHERE id = $1 RETURNING *`, [thresholdOperationId]);
        resolvedOperation = approved.rows[0] || operationRow;
      }
      await client.query("COMMIT");
      return { status: "success", operation: toThresholdOperationResponse(resolvedOperation), approvals, alreadyApproved: approvalInsert.rowCount === 0 };
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  }

  async executeThresholdOperation(userId: number, thresholdOperationId: number) {
    if (!Number.isInteger(thresholdOperationId) || thresholdOperationId <= 0) throw new BadRequestException({ error: "Invalid threshold operation id" });
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const operationResult = await client.query("SELECT * FROM threshold_operations WHERE id = $1 FOR UPDATE", [thresholdOperationId]);
      let operationRow = operationResult.rows[0];
      if (!operationRow) { await client.query("ROLLBACK"); throw new NotFoundException({ error: "Threshold operation not found" }); }
      if (["executed", "cancelled", "rejected"].includes(String(operationRow.status))) { await client.query("ROLLBACK"); throw new ConflictException({ error: `Operation is already ${operationRow.status}` }); }
      if (operationRow.expires_at && new Date(operationRow.expires_at).getTime() <= Date.now()) {
        await client.query("UPDATE threshold_operations SET status = 'expired', updated_at = NOW() WHERE id = $1", [thresholdOperationId]);
        await client.query("COMMIT"); throw new ConflictException({ error: "Operation is expired" });
      }

      if (String(operationRow.status) === "pending") {
        const approvalCountResult = await client.query("SELECT COUNT(*)::int AS count FROM threshold_operation_approvals WHERE threshold_operation_id = $1", [thresholdOperationId]);
        const approvals = Number(approvalCountResult.rows[0]?.count || 0);
        if (approvals >= Number(operationRow.required_approvals || THRESHOLD_DEFAULT_APPROVALS)) {
          const approved = await client.query(`UPDATE threshold_operations SET status = 'approved', approved_at = COALESCE(approved_at, NOW()), updated_at = NOW() WHERE id = $1 RETURNING *`, [thresholdOperationId]);
          operationRow = approved.rows[0] || operationRow;
        }
      }

      if (String(operationRow.status) !== "approved") { await client.query("ROLLBACK"); throw new ConflictException({ error: "Operation is not approved" }); }

      const executed = await client.query(
        `UPDATE threshold_operations SET status = 'executed', executed_at = NOW(), executed_by = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [thresholdOperationId, userId],
      );
      await client.query("COMMIT");
      return { status: "success", operation: toThresholdOperationResponse(executed.rows[0]) };
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  }

  async getThresholdOperation(thresholdOperationId: number) {
    if (!Number.isInteger(thresholdOperationId) || thresholdOperationId <= 0) throw new BadRequestException({ error: "Invalid threshold operation id" });
    const pool = this.db.getPool();
    const operationResult = await pool.query("SELECT * FROM threshold_operations WHERE id = $1", [thresholdOperationId]);
    const operation = operationResult.rows[0];
    if (!operation) throw new NotFoundException({ error: "Threshold operation not found" });

    const approvals = await pool.query(
      `SELECT a.account_id, acc.username, a.created_at FROM threshold_operation_approvals a JOIN accounts acc ON acc.id = a.account_id WHERE a.threshold_operation_id = $1 ORDER BY a.created_at ASC`,
      [thresholdOperationId],
    );
    return { status: "success", operation: toThresholdOperationResponse(operation), approvals: approvals.rows };
  }

  // ZK CIRCUITS
  async registerZkCircuit(userId: number, body: any) {
    const circuitName = String(body?.circuitName || "").trim().slice(0, 96);
    const circuitVersion = String(body?.circuitVersion || "").trim().slice(0, 32);
    const verificationKey = String(body?.verificationKey || "").trim();
    const governanceStatus = String(body?.governanceStatus || "proposed").trim().toLowerCase();

    if (!circuitName || !circuitVersion || !verificationKey) throw new BadRequestException({ error: "circuitName, circuitVersion, and verificationKey are required" });
    if (!["proposed", "active", "deprecated", "revoked"].includes(governanceStatus)) throw new BadRequestException({ error: "governanceStatus must be proposed|active|deprecated|revoked" });

    const pool = this.db.getPool();
    const verificationKeyHash = sha3Hex(verificationKey);
    const result = await pool.query(
      `INSERT INTO zk_circuit_registry (circuit_name, circuit_version, governance_status, verification_key, verification_key_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (circuit_name, circuit_version) DO UPDATE SET governance_status = EXCLUDED.governance_status, verification_key = EXCLUDED.verification_key, verification_key_hash = EXCLUDED.verification_key_hash, updated_at = NOW() RETURNING *`,
      [circuitName, circuitVersion, governanceStatus, verificationKey, verificationKeyHash, userId],
    );
    return { status: "success", circuit: result.rows[0] };
  }

  async updateZkCircuitStatus(id: number, nextStatus: string) {
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException({ error: "Invalid circuit id" });
    if (!["proposed", "active", "deprecated", "revoked"].includes(nextStatus)) throw new BadRequestException({ error: "status must be proposed|active|deprecated|revoked" });
    const transitions: Record<string, string[]> = { proposed: ["active", "revoked"], active: ["deprecated", "revoked"], deprecated: ["revoked"], revoked: [] };
    const pool = this.db.getPool();
    const current = await pool.query("SELECT * FROM zk_circuit_registry WHERE id = $1", [id]);
    const row = current.rows[0];
    if (!row) throw new NotFoundException({ error: "Circuit not found" });
    const currentStatus = String(row.governance_status || "proposed");
    if (currentStatus !== nextStatus && !(transitions[currentStatus] || []).includes(nextStatus)) throw new ConflictException({ error: `Invalid governance transition from ${currentStatus} to ${nextStatus}` });
    const updated = await pool.query("UPDATE zk_circuit_registry SET governance_status = $2, updated_at = NOW() WHERE id = $1 RETURNING *", [id, nextStatus]);
    return { status: "success", circuit: updated.rows[0] };
  }

  // ZK PROOFS
  async generateZkProof(userId: number, operationId: string, body: any) {
    const circuitName = String(body?.circuitName || "").trim().slice(0, 96);
    const circuitVersion = String(body?.circuitVersion || "").trim().slice(0, 32);
    if (!circuitName || !circuitVersion) throw new BadRequestException({ error: "circuitName and circuitVersion are required" });

    const witness = body?.witness;
    const publicInputs = body?.publicInputs && typeof body.publicInputs === "object" ? body.publicInputs : {};
    const witnessCanonical = typeof witness === "string" ? witness : canonicalJson(witness || {});
    if (Buffer.byteLength(witnessCanonical, "utf8") > ZK_MAX_WITNESS_BYTES) throw new HttpException("Witness payload is too large", 413);

    const pool = this.db.getPool();
    const circuit = await pool.query(`SELECT * FROM zk_circuit_registry WHERE circuit_name = $1 AND circuit_version = $2 AND governance_status = 'active' LIMIT 1`, [circuitName, circuitVersion]);
    const circuitRow = circuit.rows[0];
    if (!circuitRow) throw new NotFoundException({ error: "Active circuit version not found" });

    const witnessHash = sha3Hex(witnessCanonical);
    const publicInputsCanonical = canonicalJson(publicInputs);
    const proofHash = buildProofHash({ verificationKeyHash: circuitRow.verification_key_hash, witnessHash, publicInputsCanonical });

    const typedEvent = { eventType: String(body?.typedEventType || "zk.proof.verified"), operationId, circuit: { name: circuitName, version: circuitVersion }, proofHash };
    const created = await pool.query(
      `INSERT INTO zk_proof_sessions (operation_id, account_id, circuit_name, circuit_version, public_inputs, witness_hash, proof_hash, typed_event)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb) RETURNING *`,
      [operationId, userId, circuitName, circuitVersion, JSON.stringify(publicInputs), witnessHash, proofHash, JSON.stringify(typedEvent)],
    );
    return { status: "success", proof: created.rows[0] };
  }

  async verifyZkProof(userId: number, operationId: string, proofId: number) {
    if (!Number.isInteger(proofId) || proofId <= 0) throw new BadRequestException({ error: "Invalid proof id" });
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const proofResult = await client.query("SELECT * FROM zk_proof_sessions WHERE id = $1 FOR UPDATE", [proofId]);
      const proofRow = proofResult.rows[0];
      if (!proofRow) { await client.query("ROLLBACK"); throw new NotFoundException({ error: "Proof session not found" }); }
      const circuitResult = await client.query(`SELECT * FROM zk_circuit_registry WHERE circuit_name = $1 AND circuit_version = $2 LIMIT 1`, [proofRow.circuit_name, proofRow.circuit_version]);
      const circuitRow = circuitResult.rows[0];
      if (!circuitRow) { await client.query("ROLLBACK"); throw new NotFoundException({ error: "Circuit for proof session not found" }); }

      const publicInputsCanonical = canonicalJson(proofRow.public_inputs || {});
      const expectedProofHash = buildProofHash({ verificationKeyHash: circuitRow.verification_key_hash, witnessHash: proofRow.witness_hash, publicInputsCanonical });
      const valid = expectedProofHash === String(proofRow.proof_hash || "");

      if (valid) {
        await client.query("UPDATE zk_proof_sessions SET verified = TRUE, verified_at = NOW() WHERE id = $1", [proofId]);
        await securityLedger.appendSecurityLedgerEvent(client, {
          chainScope: "zk-proof", eventType: "zk.proof.verified", serviceName: "backend", actorType: "user", actorId: String(userId), correlationId: operationId,
          payload: { proofSessionId: proofId, circuitName: proofRow.circuit_name, circuitVersion: proofRow.circuit_version, typedEvent: proofRow.typed_event || {} },
        });
      }
      await client.query("COMMIT");
      return { status: "success", valid, expectedProofHash, proofHash: proofRow.proof_hash, typedEvent: proofRow.typed_event };
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  }

  async getZkProof(proofId: number) {
    if (!Number.isInteger(proofId) || proofId <= 0) throw new BadRequestException({ error: "Invalid proof id" });
    const pool = this.db.getPool();
    const result = await pool.query("SELECT * FROM zk_proof_sessions WHERE id = $1", [proofId]);
    if (!result.rows[0]) throw new NotFoundException({ error: "Proof session not found" });
    return { status: "success", proof: result.rows[0] };
  }

  // MPC SESSIONS
  async createMpcSession(userId: number, operationId: string, body: any) {
    const operationType = String(body?.operationType || body?.operation_type || "").trim().slice(0, 64);
    if (!operationType) throw new BadRequestException({ error: "operationType is required" });
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
    const participantsInput = Array.isArray(body?.participants) ? body.participants : [userId];
    const participants = Array.from(new Set(participantsInput.map((v: any) => Number.parseInt(v, 10)).filter((v: number) => Number.isInteger(v) && v > 0)));
    if (participants.length === 0) throw new BadRequestException({ error: "participants must contain at least one account id" });
    const quorumRequired = Math.min(Math.max(Number.parseInt(body?.quorumRequired || body?.quorum_required || "0", 10) || 2, 2), participants.length);

    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const payloadHash = sha3Hex(canonicalJson(payload));
      const created = await client.query(`INSERT INTO mpc_quorum_sessions (operation_id, operation_type, payload_hash, quorum_required, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [operationId, operationType, payloadHash, quorumRequired, userId]);
      const session = created.rows[0];
      for (const accountId of participants) {
        await client.query(`INSERT INTO mpc_quorum_participants (session_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [session.id, accountId]);
      }
      await this.appendMpcTranscript(client, { sessionId: session.id, participantAccountId: userId, eventType: "session.created", payload: { operationId: session.operation_id, operationType: session.operation_type, quorumRequired: session.quorum_required, participants } });
      await client.query("COMMIT");
      return { status: "success", session, participants };
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  }

  async signMpcSession(userId: number, operationId: string, sessionId: number, partialSignatureInput?: string) {
    if (!Number.isInteger(sessionId) || sessionId <= 0) throw new BadRequestException({ error: "Invalid session id" });
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await this.enforceMpcTranscriptRateLimit(client, userId);
      const sessionResult = await client.query("SELECT * FROM mpc_quorum_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
      const session = sessionResult.rows[0];
      if (!session) { await client.query("ROLLBACK"); throw new NotFoundException({ error: "MPC session not found" }); }
      if (["finalized", "cancelled", "expired"].includes(String(session.status))) { await client.query("ROLLBACK"); throw new ConflictException({ error: `MPC session is ${session.status}` }); }

      const participantResult = await client.query(`SELECT * FROM mpc_quorum_participants WHERE session_id = $1 AND account_id = $2 LIMIT 1`, [sessionId, userId]);
      const participant = participantResult.rows[0];
      if (!participant) { await client.query("ROLLBACK"); throw new ForbiddenException({ error: "Account is not a participant for this session" }); }
      if (participant.signed_at) { await client.query("ROLLBACK"); throw new ConflictException({ error: "Participant already signed" }); }

      const partialSignature = String(partialSignatureInput || "").trim() || `mpc_${sha3Hex(`${session.operation_id}|${userId}|${Date.now()}|${operationId}`)}`;
      await client.query(`UPDATE mpc_quorum_participants SET partial_signature = $3, signed_at = NOW() WHERE session_id = $1 AND account_id = $2`, [sessionId, userId, partialSignature]);

      await this.appendMpcTranscript(client, { sessionId, participantAccountId: userId, eventType: "participant.signed", payload: { sessionId, accountId: userId, operationId: session.operation_id, partialSignatureHash: sha3Hex(partialSignature) } });

      const signedCountResult = await client.query(`SELECT COUNT(*)::int AS count FROM mpc_quorum_participants WHERE session_id = $1 AND signed_at IS NOT NULL`, [sessionId]);
      const signedCount = Number(signedCountResult.rows[0]?.count || 0);

      let status = String(session.status || "pending");
      if (signedCount >= Number(session.quorum_required || 2) && status !== "ready") {
        const updated = await client.query("UPDATE mpc_quorum_sessions SET status = 'ready' WHERE id = $1 RETURNING status", [sessionId]);
        status = String(updated.rows[0]?.status || "ready");
      }
      await client.query("COMMIT");
      return { status: "success", sessionId, quorumRequired: Number(session.quorum_required || 2), signedCount, sessionStatus: status };
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  }

  async finalizeMpcSession(userId: number, operationId: string, sessionId: number) {
    if (!Number.isInteger(sessionId) || sessionId <= 0) throw new BadRequestException({ error: "Invalid session id" });
    const pool = this.db.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sessionResult = await client.query("SELECT * FROM mpc_quorum_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
      const session = sessionResult.rows[0];
      if (!session) { await client.query("ROLLBACK"); throw new NotFoundException({ error: "MPC session not found" }); }
      if (String(session.status) === "finalized") { await client.query("ROLLBACK"); throw new ConflictException({ error: "MPC session already finalized" }); }

      const signaturesResult = await client.query(`SELECT partial_signature FROM mpc_quorum_participants WHERE session_id = $1 AND signed_at IS NOT NULL ORDER BY account_id ASC`, [sessionId]);
      const signatures = signaturesResult.rows.map((entry: any) => String(entry.partial_signature || "").trim()).filter(Boolean);
      if (signatures.length < Number(session.quorum_required || 2)) { await client.query("ROLLBACK"); throw new ConflictException({ error: "Session quorum has not been reached" }); }

      const combinedSignatureHash = sha3Hex(signatures.join("|"));
      const updated = await client.query(`UPDATE mpc_quorum_sessions SET status = 'finalized', finalized_at = NOW() WHERE id = $1 RETURNING *`, [sessionId]);

      await this.appendMpcTranscript(client, { sessionId, participantAccountId: userId, eventType: "session.finalized", payload: { sessionId, operationId: session.operation_id, combinedSignatureHash, signatureCount: signatures.length } });

      await securityLedger.appendSecurityLedgerEvent(client, {
        chainScope: "mpc-quorum", eventType: "mpc.quorum.finalized", serviceName: "backend", actorType: "user", actorId: String(userId), correlationId: operationId,
        payload: { sessionId, operationId: session.operation_id, combinedSignatureHash, signatureCount: signatures.length },
      });

      await client.query("COMMIT");
      return { status: "success", session: updated.rows[0], combinedSignatureHash, signatureCount: signatures.length };
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; } finally { client.release(); }
  }

  async getMpcSession(sessionId: number) {
    if (!Number.isInteger(sessionId) || sessionId <= 0) throw new BadRequestException({ error: "Invalid session id" });
    const pool = this.db.getPool();
    const sessionResult = await pool.query("SELECT * FROM mpc_quorum_sessions WHERE id = $1", [sessionId]);
    const session = sessionResult.rows[0];
    if (!session) throw new NotFoundException({ error: "MPC session not found" });
    const participants = await pool.query(`SELECT p.account_id, a.username, p.signed_at FROM mpc_quorum_participants p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.session_id = $1 ORDER BY p.account_id ASC`, [sessionId]);
    const transcripts = await pool.query(`SELECT id, participant_account_id, event_type, created_at FROM mpc_quorum_transcripts WHERE session_id = $1 ORDER BY created_at ASC`, [sessionId]);
    return { status: "success", session, participants: participants.rows, transcripts: transcripts.rows };
  }
}
