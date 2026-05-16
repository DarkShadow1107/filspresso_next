# Sisteme de Backend Securizate utilizând Criptografie „Zero Trust” și Arhitecturi Distribuite

## Abstract

This paper presents a secure backend architecture for distributed systems, designed around confidentiality, integrity, and verifiability. A NestJS core is complemented by specialized Rust, Rust-WASM, and Go services to remove single points of compromise. Sensitive data is protected with AES-256-GCM and context-derived keys, service identity is enforced through Ed25519 assertions and mTLS, and ephemeral security states are managed in Redis. Long-term integrity is anchored in PostgreSQL through an immutable, SHA3-256 hash-chained ledger. The resulting Zero Trust model remains resilient under partial compromise.

**Cuvinte cheie:** Criptografie, Zero Trust, Securitate distribuită, Imutabilitate, Redis.

## 1. Introducere

În arhitecturile moderne cu microservicii, securitatea perimetrală nu mai este suficientă. Dacă încrederea este concentrată într-un singur serviciu, compromiterea acelui punct compromite întreg sistemul. Problema centrală devine deci distribuirea controlului criptografic și a mecanismelor de verificare.

Obiectivul lucrării este proiectarea și validarea unui backend care aplică principii Zero Trust în mod practic: fără încredere implicită între componente, cu verificare criptografică explicită și cu audit rezistent la manipulare. În acest context, compromiterea unei componente trebuie să producă impact local, nu sistemic. [1]

Arhitectura este construită ca o federație tehnologică: NestJS orchestrează fluxurile, Rust execută validări criptografice deterministe, Rust-WASM menține coerența client-server pentru fluxuri de tip Zero Knowledge, iar Go gestionează identitatea de serviciu și transportul mTLS. Redis acoperă stările volatile cu cerințe stricte de latență, iar PostgreSQL oferă persistență cu proprietăți native de tamper-evidence.

## 2. Stadiul actual al domeniului

Majoritatea backend-urilor comerciale folosesc OAuth 2.0/OIDC și TLS, dar păstrează un perimetru intern de încredere. În practică, odată intrată în rețeaua internă, o cerere este adesea tratată prea permisiv. Aceasta rămâne o suprafață de risc importantă.

În zona de date, criptarea la nivel de disc sau TDE protejează mai ales împotriva furtului mediului de stocare, nu împotriva abuzului logic din aplicație. Dacă aplicația este compromisă, datele pot fi accesate în clar. În paralel, bazele relaționale sunt frecvent încărcate cu stări efemere (nonces, blacklist-uri, rate limits), deși aceste fluxuri sunt mai potrivite pentru in-memory stores precum Redis.

Auditarea este, de regulă, externalizată în SIEM. Modelul este util pentru observabilitate, dar nu garantează imutabilitatea locală înainte de export. În acest punct, lucrarea propune o diferență clară: integritatea jurnalelor este impusă direct în baza de date, nu doar în pipeline-ul de monitorizare.

## 3. Arhitectura Ecosistemului și Delimitarea Contextuală

Filspresso Next separă explicit planul operațional de cel criptografic. Designul urmează trei principii:

1. Nicio componentă individuală nu deține autoritate totală.
2. Datele sensibile sunt reprezentate și procesate verificabil criptografic, cu expunere minimă a secretelor în clar.
3. Integritatea auditului este garantată la nivel de infrastructură de date.

[PLACEHOLDER IMAGINE 1 - Inserează aici diagrama UML a componentelor aplicației (din `docs/uml/full-app-component-diagram.png` sau `.svg`). Centrează imaginea și adaugă sub ea legenda: *Figura 1. Arhitectura de sistem federată, care evidențiază separarea orchestratorului principal (NestJS) de serviciile criptografice (Rust) și operaționale (Go).*]

Rolurile principale sunt:

- **NestJS**: orchestrare, validare de intrare, aplicare politici.
- **Rust**: calcul criptografic izolat și verificare deterministă.
- **Rust-WASM**: paritate criptografică browser-server pentru fluxuri Zero Knowledge.
- **Go**: mTLS, validare SPIFFE și control strict al identității de serviciu.

## 4. Descentralizarea Autorității Criptografice: "The Server Cannot Be Hacked as a Single Entity"

Modelul propus mută validările critice dintr-un monolit către componente specializate, reducând riscul de compromitere totală. În acest design, NestJS orchestrează, iar Rust validează independent materialul criptografic.

Pentru atacurile de tip replay, backend-ul aplică un Replay Guard care rezervă semantic operațiunile înainte de execuție.

[PLACEHOLDER COD 1]
**Sursa:** `nestjs-backend/src/common/utils/replayGuard.ts`
**Liniile recomandate:** 4-48
**Text recomandat sub cod:**
_Fragmentul arată prevenirea atacurilor de replay prin normalizarea și rezervarea unui `operation_id` asociat unui `actor_id` și unui `scope`. Unicitatea operațiunii este verificată în Redis, ceea ce păstrează latența mică și impune idempotență strictă fără blocarea fluxului tranzacțional principal din PostgreSQL._

Validările inter-servicii sunt tratate separat, în Rust, pentru a reduce încrederea implicită în orchestrator.

[PLACEHOLDER COD 2]
**Sursa:** `rust-crypto-service/src/main.rs`
**Liniile recomandate:** 250-280 (Secțiunea de validare a `service assertions`)
**Text recomandat sub cod:**
_Secvența Rust verifică aserțiunile inbound la nivel strict: extrage `operation_id`, îl corelează cu `jti` și respinge inconsistențele. Acest pas blochează falsificarea internă și menține canonicalizarea datelor într-un mediu cu efecte secundare controlate._

## 5. Integritatea Imuabilă a Datelor: Mecanisme Native _Tamper-Evidence_

Un audit log sigur nu trebuie să depindă exclusiv de buna credință a codului aplicației. Dacă apare RCE, atacatorul poate încerca să altereze istoricul. Soluția adoptată este impunerea imutabilității direct în PostgreSQL.

[PLACEHOLDER COD 3]
**Sursa:** `nestjs-backend/src/database/ensureAppSchema.ts`
**Liniile recomandate:** 407-413 (Definirea triggerelor pentru imutabilitate)
**Text recomandat sub cod:**
_Fragmentul DDL implementează tamper-evidence nativ în baza de date. Trigger-ele `forbid_security_event_ledger_update` blochează UPDATE/DELETE pe ledger, indiferent de privilegiile contului aplicativ. Istoricul devine efectiv append-only._

În plus, evenimentele sunt înlănțuite prin SHA3-256, ceea ce face detectabilă orice alterare retrospectivă.

## 6. Fundamentele _Zero Trust_: Identitate, Autorizare și _mTLS_

Într-un model Zero Trust, rețeaua internă este considerată neîncrezătoare by design. Decizia de acces se bazează pe identitate criptografică verificată, nu pe poziția în rețea.

[PLACEHOLDER COD 4]
**Sursa:** `go-ops-service/main.go`
**Liniile recomandate:** 427-460 (Configurarea mTLS și validarea SPIFFE)
**Text recomandat sub cod:**
_Secvența Go configurează mTLS cu autentificare mutuală și validează identitatea serviciului din SAN pe format SPIFFE (de tip `spiffe://filspresso/internal/backend`). Accesul este permis doar identităților din allowlist, eliminând încrederea implicită bazată pe IP._ [9]

Autorizarea la nivel aplicativ este tratată declarativ prin OPA, cu politică de deny-by-default.

[PLACEHOLDER COD 5]
**Sursa:** `security/opa/policies/filspresso-authz.rego`
**Liniile recomandate:** 3-15
**Text recomandat sub cod:**
_Regula `default allow = false` impune modelul minim de privilegii. Permisiunile sunt acordate explicit, în funcție de identitate, resursă și context operațional evaluat dinamic de OPA._

## 7. Confidențialitatea Datelor și Criptografia de Stocare

Confidențialitatea datelor este implementată cu AES-256-GCM, dar siguranța practică este dată de managementul cheilor. Cheile operaționale sunt derivate cu HKDF și legate de context prin AAD. [6]

[PLACEHOLDER COD 6]
**Sursa:** `nestjs-backend/src/common/utils/encryption.ts`
**Liniile recomandate:** 56-90 (Funcția de derivare HKDF și criptarea AEAD)
**Text recomandat sub cod:**
*Fragmentul arată derivare contextuală a cheilor și criptare AEAD. AAD leagă criptograma de entitate și de context, astfel încât un ciphertext valid într-un context nu poate fi reutilizat valid în altul. Astfel este redus riscul de tip ciphertext malleability și de replay contextual.*

Pentru parole, Argon2id oferă rezistență ridicată la brute-force prin costuri ajustabile de timp și memorie.

## 8. Pași către _Zero Knowledge_ și Calcul Multi-Parte (MPC)

[PLACEHOLDER COD 7]
Arhitectura pregătește tranzacții sensibile pentru execuție distribuită, fără centralizarea deciziei în conturi privilegiate unice. În NestJS sunt modelate sesiuni de tip threshold/quorum. [4]
**Sursa:** `nestjs-backend/src/crypto/crypto.service.ts`
**Liniile recomandate:** 384-420 (Structurarea sesiunilor MPC / Threshold)
**Text recomandat sub cod:**
_Codul descrie o sesiune MPC de tip quorum: operațiunile sensibile cer un prag minim de aprobări criptografice parțiale. Decizia finală rezultă din consens distribuit, ceea ce reduce riscul de abuz intern._

Aceeași logică este extinsă client-side prin `rust-wasm`, unde datele sunt transformate în martori criptografici înainte de transmitere.

## 9. Evaluare Experimentală și Valabilitatea Implementării

Testarea experimentală confirmă că modelul de securitate nu introduce costuri prohibitive în operațiunile critice. Suita strictă arată stabilitate ridicată atât pe criterii de securitate, cât și de performanță.

[PLACEHOLDER IMAGINE 2 - Inserează aici un screenshot (crop) din raportul testelor. Capturează doar aceste rânduri din `tests/logs/strict_no_integration_20260425_182523/summary.txt`:

- Header / metadata: [tests/logs/strict_no_integration_20260425_182523/summary.txt](tests/logs/strict_no_integration_20260425_182523/summary.txt#L1-L5)
- Overall score & weights: [tests/logs/strict_no_integration_20260425_182523/summary.txt](tests/logs/strict_no_integration_20260425_182523/summary.txt#L7-L8)
- Category breakdown (Security / Performance / Reliability / Compliance): [tests/logs/strict_no_integration_20260425_182523/summary.txt](tests/logs/strict_no_integration_20260425_182523/summary.txt#L11-L15)
- SLA evidence (Encryption p95, Ledger p95, Health p95): [tests/logs/strict_no_integration_20260425_182523/summary.txt](tests/logs/strict_no_integration_20260425_182523/summary.txt#L48-L52)
- (Optional) RunLog path for reproducibility: [tests/logs/strict_no_integration_20260425_182523/summary.txt](tests/logs/strict_no_integration_20260425_182523/summary.txt#L65)

Folosește ordinea de sus în jos: metadata → overall score → category breakdown → SLA evidence → nota/regres. Adaugă legenda sub imagine: *Figura 2. Raportul de testare — excerpt cu scoruri și p95 relevante (source: tests/logs/strict_no_integration_20260425_182523/summary.txt).*]

Rezultatele-cheie raportate:

- Securitate globală și fiabilitate: 100%.
- Latență p95 la criptare: 0.18 ms (SLA < 5 ms).
- Latență p95 pentru scriere în ledger: 0.013 ms (SLA < 2 ms).

Latența p95 de 125.32 ms pe health check reflectă costul agregării verificărilor distribuite Zero Trust, un compromis acceptabil în raport cu nivelul de izolare obținut.

## 10. Concluzii

Implementarea validează un backend distribuit în care încrederea este explicită, verificabilă și compartimentată. Combinația dintre orchestrare NestJS, validări criptografice Rust, transport securizat Go/mTLS și ledger imuabil în PostgreSQL produce un profil de securitate solid pentru producție.

Contribuția principală este demonstrarea practică a faptului că principii precum Zero Trust, Zero Knowledge și audit tamper-evident pot fi integrate într-o arhitectură operațională fără degradări critice de performanță.

---

## 11. Bibliografie

1. **Rose, S., Borchert, O., Mitchell, S., & Connelly, S.** (2020). _Zero Trust Architecture_ (NIST Special Publication 800-207). National Institute of Standards and Technology.
2. **Goldwasser, S., Micali, S., & Rackoff, C.** (1989). "The Knowledge Complexity of Interactive Proof Systems". _SIAM Journal on Computing_, 18(1), 186–208. _(Pentru fundamentarea teoretică a conceptelor Zero Knowledge prelucrate prin Wasm)_.
3. **Gilman, E., & Barth, D.** (2017). _Zero Trust Networks: Building Secure Systems in Untrusted Networks_. O'Reilly Media.
4. **Cramer, R., Damgård, I., & Nielsen, J. B.** (2015). _Secure Multiparty Computation and Secret Sharing_. Cambridge University Press. _(Pentru analiza modelelor de prag/Threshold și dispersia deciziei criptografice din sistem)_.
5. **Dworkin, M.** (2007). _Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC_ (NIST SP 800-38D).
6. **Krawczyk, H., & Eronen, P.** (2010). _HMAC-based Extract-and-Expand Key Derivation Function (HKDF)_. RFC 5869, Internet Engineering Task Force (IETF).
7. **Beyer, B., Jones, C., Petoff, J., & Murphy, N. R.** (2016). _Site Reliability Engineering: How Google Runs Production Systems_. O'Reilly Media. _(Aplicabil pentru principiile de operare și monitorizare a latenței sistemelor sigure)._
8. **Open Policy Agent (OPA) Documentation**. (2025). _Declarative Authorization for Cloud Native Environments_. Cloud Native Computing Foundation (CNCF).
9. **SPIFFE/SPIRE Standards**. (2025). _Secure Production Identity Framework for Everyone_. Cloud Native Computing Foundation (CNCF). _(Pentru fundamentarea implementării de identitate în microserviciul Go)._
