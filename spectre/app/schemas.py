from datetime import datetime
from typing import Any, ClassVar, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl

from app.models import (
    ArtifactKind,
    CaseStatus,
    FindingSeverity,
    FindingStatus,
    MembershipRole,
    ProposalStatus,
    ScanStatus,
    TaskStatus,
)


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: str


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    display_name: str
    is_active: bool
    created_at: datetime


class TokenPair(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user: UserRead


class UserMemoryPreferenceRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class UserMemoryPreferenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class UserMemoryRecordCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=500)
    content: str = Field(min_length=1, max_length=16_384)


class UserMemoryUrlCaptureCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1, max_length=2_048)


class UserMemoryRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: str
    title: str | None
    content: str
    source_url: str | None
    created_at: datetime


class OrganizationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=160)
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,98}$")


class OrganizationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    created_at: datetime


class MembershipCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    role: MembershipRole = MembershipRole.ANALYST


class ResearchCaseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=240)
    question: str = Field(min_length=10, max_length=12_000)
    asset_profile: dict[str, Any] = Field(default_factory=dict)
    agent_settings: "AgentSettings | None" = None


class AgentSettings(BaseModel):
    """Bounded Granite 4.2 workflow controls supplied by the static chat client."""

    model_config = ConfigDict(extra="forbid")

    profile: Literal["fast", "balanced", "deep"] = "balanced"
    max_sources: int | None = Field(default=None, ge=1, le=20)
    fetch_top: int | None = Field(default=None, ge=1, le=10)
    context_window: Literal[32_768, 65_536, 131_072] = 65_536
    reasoning_level: Literal["default", "low", "medium", "high", "xhigh", "max"] = "default"
    stage_max_tokens: int | None = Field(default=None, ge=256, le=4_096)
    synthesis_tokens: int | None = Field(default=None, ge=512, le=8_192)
    temperature: float | None = Field(default=None, ge=0.0, le=1.0)
    wall_seconds: int | None = Field(default=None, ge=60, le=3_600)
    compaction: Literal["off", "balanced", "proactive", "aggressive"] = "balanced"
    memory_enabled: bool = True
    enable_code_analysis: bool | None = None

    PRESETS: ClassVar[dict[str, dict[str, Any]]] = {
        "fast": {
            "max_sources": 5,
            "fetch_top": 2,
            "stage_max_tokens": 700,
            "synthesis_tokens": 1_200,
            "temperature": 0.12,
            "wall_seconds": 300,
            "compaction": "aggressive",
            "enable_code_analysis": False,
        },
        "balanced": {
            "max_sources": 8,
            "fetch_top": 3,
            "stage_max_tokens": 1_400,
            "synthesis_tokens": 2_400,
            "temperature": 0.2,
            "wall_seconds": 600,
            "compaction": "balanced",
            "enable_code_analysis": True,
        },
        "deep": {
            "max_sources": 12,
            "fetch_top": 5,
            "stage_max_tokens": 2_200,
            "synthesis_tokens": 3_600,
            "temperature": 0.22,
            "wall_seconds": 1_800,
            "compaction": "proactive",
            "enable_code_analysis": True,
        },
    }

    REASONING: ClassVar[dict[str, dict[str, float | int]]] = {
        "low": {"stage_max_tokens": 700, "synthesis_tokens": 1_200, "temperature": 0.1},
        "medium": {"stage_max_tokens": 1_000, "synthesis_tokens": 1_800, "temperature": 0.15},
        "high": {"stage_max_tokens": 1_400, "synthesis_tokens": 2_400, "temperature": 0.2},
        "xhigh": {"stage_max_tokens": 2_200, "synthesis_tokens": 3_600, "temperature": 0.2},
        "max": {"stage_max_tokens": 3_200, "synthesis_tokens": 5_200, "temperature": 0.22},
    }

    def resolved(self) -> dict[str, Any]:
        preset = dict(self.PRESETS[self.profile])
        reasoning = "high" if self.reasoning_level == "default" else self.reasoning_level
        preset.update(self.REASONING[reasoning])
        overrides = self.model_dump(
            exclude={"profile", "reasoning_level"},
            exclude_none=True,
        )
        if "compaction" not in self.model_fields_set:
            overrides.pop("compaction", None)
        for key, value in overrides.items():
            preset[key] = value
        preset["reasoning_level"] = self.reasoning_level
        return preset


class ResearchCaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    owner_id: UUID | None
    title: str
    question: str
    asset_profile: dict[str, Any]
    agent_settings: dict[str, Any]
    status: CaseStatus
    created_at: datetime
    updated_at: datetime


class ResearchRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    case_id: UUID
    repository_id: UUID | None
    conversation_id: str | None
    status: CaseStatus
    current_stage: str
    blackboard: dict[str, Any]
    budget: dict[str, Any]
    settings: dict[str, Any]
    cancelled_at: datetime | None
    created_at: datetime
    completed_at: datetime | None


class AgentTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    agent_name: str
    task_type: str
    status: TaskStatus
    depends_on: list[str]
    input_payload: dict[str, Any]
    result_payload: dict[str, Any]
    error: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class AgentEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    task_id: UUID | None
    agent_name: str
    event_type: str
    content: str
    payload: dict[str, Any]
    created_at: datetime


class CodeProposalCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=240)
    purpose: str = Field(min_length=1, max_length=4_000)
    code: str = Field(min_length=1, max_length=20_000)
    input_json: dict[str, Any] = Field(default_factory=dict)
    case_id: UUID | None = None


class CodeProposalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    case_id: UUID | None
    run_id: UUID | None
    title: str
    purpose: str
    code: str
    input_json: dict[str, Any]
    status: ProposalStatus
    result_payload: dict[str, Any] | None
    error: str | None
    created_at: datetime
    reviewed_at: datetime | None
    executed_at: datetime | None


class AccountDeletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=1, max_length=256)


class SourceRecordRead(BaseModel):
    id: UUID
    title: str | None
    url: str
    tier: str
    version_id: UUID
    content_hash: str
    fetched_at: datetime | None
    chunks: int
    embedded: int


class RepositoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=240)
    remote_url: HttpUrl | None = None


class RepositoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    remote_url: str | None
    commit_sha: str | None
    status: str
    manifest: dict[str, Any]
    created_at: datetime


class CodeSentryScanCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tier: Literal["T1", "T2", "T3"] = "T1"
    max_findings: int = Field(default=500, ge=1, le=2_000)
    run_static_scanners: bool = True
    run_repository_tests: bool = False
    request_poc_proposals: bool = True


class RepositoryAuditCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=3, max_length=240)
    question: str = Field(min_length=10, max_length=12_000)
    conversation_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        pattern=r"^[A-Za-z0-9_.:/-]+$",
    )
    agent_settings: AgentSettings | None = None
    scan_tier: Literal["T1", "T2", "T3"] = "T1"
    run_static_scanners: bool = True
    run_repository_tests: bool = True
    request_poc_proposals: bool = True


class CodeSentryScanRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    repository_id: UUID
    snapshot_id: UUID | None
    requested_by_id: UUID | None
    status: ScanStatus
    current_stage: str
    settings: dict[str, Any]
    summary: dict[str, Any]
    error: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None


class CodeSentryFindingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scan_run_id: UUID
    snapshot_id: UUID | None
    repository_file_id: UUID | None
    source: str
    rule_id: str
    cwe: str | None
    severity: FindingSeverity
    title: str
    description: str
    evidence: str
    line_start: int | None
    line_end: int | None
    status: FindingStatus
    llm_verdict: str | None
    confidence: float | None
    fingerprint: str
    created_at: datetime
    updated_at: datetime


class CodeSentryScanEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scan_run_id: UUID
    sequence: int
    level: str
    event_type: str
    stage: str
    message: str
    payload: dict[str, Any]
    created_at: datetime


class CodeSentryRepositoryFileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    snapshot_id: UUID
    path: str
    language: str
    size_bytes: int
    sha256: str
    line_count: int


class CodeSentryLLMUsageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scan_run_id: UUID
    operation: str
    model: str
    tier: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    context_size: int
    latency_ms: int
    success: bool
    error: str | None
    created_at: datetime


class CodeSentryPocRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scan_run_id: UUID
    finding_id: UUID
    title: str
    purpose: str
    code: str
    input_json: dict[str, Any]
    status: str
    reviewed_by_id: UUID | None
    reviewed_at: datetime | None
    executed_at: datetime | None
    exit_code: int | None
    result_json: dict[str, Any] | None
    error: str | None
    created_at: datetime


class CodeSentryDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=2_000)


class CodeSentryReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scan_run_id: UUID
    format: Literal["json", "sarif", "markdown", "pdf"]
    status: str
    schema_version: str
    content_type: str
    byte_size: int
    sha256: str
    finding_count: int
    metadata_json: dict[str, Any]
    created_at: datetime


class ArtifactCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ArtifactKind
    title: str = Field(min_length=1, max_length=240)
    case_id: UUID | None = None
    content: str = Field(default="", max_length=200_000)
    sections: list[dict[str, Any]] = Field(default_factory=list, max_length=100)


class ArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: ArtifactKind
    title: str
    case_id: UUID | None
    storage_key: str
    revision: int
    metadata_json: dict[str, Any]
    created_at: datetime


class SandboxRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=20_000)
    input_json: dict[str, Any] = Field(default_factory=dict)
    timeout_seconds: int = Field(default=25, ge=1, le=30)


class SandboxResult(BaseModel):
    stdout: str
    stderr: str
    output_json: dict[str, Any] | None = None
    exit_code: int


class RepositoryExecutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    repository_id: str = Field(pattern=r"^repo-[0-9a-f]{64}$")
    profile: Literal[
        "compile_python",
        "python_script",
        "python_tests",
        "compile_cpp",
        "cpp_script",
        "cpp_tests",
        "compile_all",
    ]
    path: str | None = Field(default=None, max_length=500)
    timeout_seconds: int = Field(default=25, ge=1, le=30)


class RepositoryExecutionResult(SandboxResult):
    model_config = ConfigDict(extra="forbid")

    repository_id: str
    profile: Literal[
        "compile_python",
        "python_script",
        "python_tests",
        "compile_cpp",
        "cpp_script",
        "cpp_tests",
        "compile_all",
    ]
    path: str | None = None


class TerminalExecutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command: str = Field(min_length=1, max_length=20_000)
    workdir: str | None = Field(default=None, max_length=500)
    timeout_seconds: int = Field(default=25, ge=1, le=30)


class TerminalExecutionResult(SandboxResult):
    model_config = ConfigDict(extra="forbid")

    command: str


class RepositoryCheckoutExecutionRequest(BaseModel):
    """Internal sandbox request for a temporary CodeSentry checkout."""

    model_config = ConfigDict(extra="forbid")

    checkout_name: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
    profile: Literal["compile_python", "python_tests"]
    timeout_seconds: int = Field(default=25, ge=1, le=30)


class RepositoryCheckoutExecutionResult(SandboxResult):
    model_config = ConfigDict(extra="forbid")

    checkout_name: str
    profile: Literal["compile_python", "python_tests"]


class CalculatorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expression: str = Field(min_length=1, max_length=500)


class CalculatorResult(BaseModel):
    expression: str
    normalized_expression: str
    angle_unit: str | None = None
    result: float | None
    error: str | None


ResearchCaseCreate.model_rebuild()
