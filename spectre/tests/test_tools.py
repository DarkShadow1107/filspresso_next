from app.services.tools import calculate, citation_coverage


def test_calculator_evaluates_only_approved_math() -> None:
    result = calculate("sqrt(81) + 2^3")

    assert result["result"] == 17.0
    assert result["error"] is None
    assert result["normalized_expression"] == "sqrt(81) + 2**3"


def test_calculator_rejects_attribute_access() -> None:
    result = calculate("().__class__.__base__")

    assert result["result"] is None
    assert result["error"]


def test_citation_coverage_excludes_unknown_source_versions() -> None:
    known = "a8c08979-5a84-4674-87c6-94d999d2ad53"
    unknown = "b8c08979-5a84-4674-87c6-94d999d2ad53"
    coverage = citation_coverage(
        (f"Supported claim [v:{known}]. Unverified marker [v:{unknown}]."),
        [{"source_version_id": known}],
    )

    assert coverage["available_source_versions"] == 1
    assert coverage["cited_source_versions"] == 1
    assert coverage["unknown_source_markers"] == [unknown]
