"""Fixed bounded interaction schema; clarification never conveys execution authority."""
from __future__ import annotations


def _string(maximum, minimum=1):
    return {"type": "string", "minLength": minimum, "maxLength": maximum}


def _object(properties):
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


QUESTION_SCHEMA = _object({"questions": {"type": "array", "minItems": 1, "maxItems": 4, "items": _object({
    "header": _string(30), "question": _string(2000), "multiple": {"type": "boolean"},
    "options": {"type": "array", "minItems": 0, "maxItems": 8, "items": _object({"label": _string(60), "description": _string(300, 0)})},
})}})


def validate_question(value):
    def check(ok):
        if not ok:
            raise ValueError("Invalid bounded question form")

    def fields(item, names):
        check(isinstance(item, dict) and set(item) == set(names))

    def text(item, maximum, empty=False):
        check(isinstance(item, str) and len(item) <= maximum and (empty or item.strip()))
        item.encode("utf-8")

    fields(value, ("questions",))
    check(isinstance(value["questions"], list) and 1 <= len(value["questions"]) <= 4)
    for question in value["questions"]:
        fields(question, ("header", "question", "multiple", "options"))
        text(question["header"], 30)
        text(question["question"], 2000)
        check(type(question["multiple"]) is bool and isinstance(question["options"], list) and len(question["options"]) <= 8)
        labels = set()
        for option in question["options"]:
            fields(option, ("label", "description"))
            text(option["label"], 60)
            text(option["description"], 300, True)
            check(option["label"] not in labels)
            labels.add(option["label"])
