"""Small deterministic tools that are safe to expose through the authenticated API."""

import ast
import math
import operator
import re
from collections.abc import Callable, Iterable
from typing import Any


class UnsafeExpression(ValueError):
    """Raised when a calculator expression falls outside the explicit grammar."""


_BINARY_OPERATORS: dict[type[ast.operator], Callable[[float, float], float]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.FloorDiv: operator.floordiv,
}
_UNARY_OPERATORS: dict[type[ast.unaryop], Callable[[float], float]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}
_FUNCTIONS: dict[str, tuple[int, int, Callable[..., float]]] = {
    "abs": (1, 1, abs),
    "ceil": (1, 1, math.ceil),
    "floor": (1, 1, math.floor),
    "sqrt": (1, 1, math.sqrt),
    "log": (1, 2, math.log),
    "log10": (1, 1, math.log10),
    "sin": (1, 1, lambda value: math.sin(math.radians(value))),
    "cos": (1, 1, lambda value: math.cos(math.radians(value))),
    "tan": (1, 1, lambda value: math.tan(math.radians(value))),
    "sinr": (1, 1, math.sin),
    "cosr": (1, 1, math.cos),
    "tanr": (1, 1, math.tan),
    "radians": (1, 1, math.radians),
    "degrees": (1, 1, math.degrees),
    "round": (1, 2, round),
}
_CONSTANTS = {"pi": math.pi, "e": math.e, "tau": math.tau}
_SOURCE_MARKER = re.compile(r"\[v:([0-9a-fA-F-]{36})\]")


def _evaluate(node: ast.AST) -> float:
    if (
        isinstance(node, ast.Constant)
        and isinstance(node.value, (int, float))
        and not isinstance(node.value, bool)
    ):
        return float(node.value)
    if isinstance(node, ast.Name) and node.id in _CONSTANTS:
        return float(_CONSTANTS[node.id])
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPERATORS:
        return _UNARY_OPERATORS[type(node.op)](_evaluate(node.operand))
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPERATORS:
        left = _evaluate(node.left)
        right = _evaluate(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise UnsafeExpression("Exponent is too large")
        try:
            result = _BINARY_OPERATORS[type(node.op)](left, right)
        except (ArithmeticError, OverflowError, TypeError, ValueError) as exc:
            raise UnsafeExpression(f"Invalid mathematical result: {exc}") from exc
        if not isinstance(result, (int, float)) or not math.isfinite(result):
            raise UnsafeExpression("Result is not a finite real number")
        return float(result)
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in _FUNCTIONS
    ):
        minimum, maximum, function = _FUNCTIONS[node.func.id]
        if node.keywords or not minimum <= len(node.args) <= maximum:
            raise UnsafeExpression("Unsupported function arguments")
        try:
            result = function(*[_evaluate(argument) for argument in node.args])
        except (ArithmeticError, OverflowError, TypeError, ValueError) as exc:
            raise UnsafeExpression(f"Invalid {node.func.id}() arguments: {exc}") from exc
        if not isinstance(result, (int, float)) or not math.isfinite(result):
            raise UnsafeExpression("Result is not a finite real number")
        return float(result)
    raise UnsafeExpression("Only arithmetic, approved functions, and pi/e/tau are allowed")


def calculate(expression: str) -> dict[str, Any]:
    """Evaluate bounded arithmetic without eval, imports, attribute access, or variables."""
    normalized = expression.strip().replace("^", "**")
    if len(normalized) > 500:
        return {
            "expression": expression,
            "normalized_expression": normalized,
            "result": None,
            "error": "Expression is too long",
        }
    try:
        tree = ast.parse(normalized, mode="eval")
        result = _evaluate(tree.body)
    except (
        SyntaxError,
        UnsafeExpression,
        ArithmeticError,
        OverflowError,
        TypeError,
        ValueError,
    ) as exc:
        detail = str(exc) or "Invalid mathematical expression"
        return {
            "expression": expression,
            "normalized_expression": normalized,
            "result": None,
            "error": detail,
        }
    return {
        "expression": expression,
        "normalized_expression": normalized,
        "angle_unit": "degrees for sin, cos, and tan; use sinr, cosr, or tanr for radians",
        "result": result,
        "error": None,
    }


def citation_coverage(report: str, source_versions: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Measure report citation coverage against persisted source-version IDs."""
    available = {
        str(item.get("source_version_id"))
        for item in source_versions
        if isinstance(item.get("source_version_id"), str)
    }
    cited = set(_SOURCE_MARKER.findall(report))
    valid = cited & available
    return {
        "available_source_versions": len(available),
        "citation_markers": len(cited),
        "cited_source_versions": len(valid),
        "unknown_source_markers": sorted(cited - available),
        "coverage_ratio": round(len(valid) / len(available), 3) if available else 0.0,
    }
