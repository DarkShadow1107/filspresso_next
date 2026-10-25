"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUESTION_SCHEMA = void 0;
exports.isQuestionSchema = isQuestionSchema;
exports.strictInteractionJson = strictInteractionJson;
exports.parseQuestionForm = parseQuestionForm;
exports.validateQuestionDecision = validateQuestionDecision;
const string = (maxLength, minLength = 1) => ({ type: "string", minLength, maxLength });
const closed = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
function freeze(value) { if (value && typeof value === "object") {
    for (const child of Object.values(value))
        freeze(child);
    Object.freeze(value);
} return value; }
exports.QUESTION_SCHEMA = freeze(closed({ questions: { type: "array", minItems: 1, maxItems: 4, items: closed({
            header: string(30), question: string(2000), multiple: { type: "boolean" },
            options: { type: "array", minItems: 0, maxItems: 8, items: closed({ label: string(60), description: string(300, 0) }) },
        }) } }));
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v, max, empty = false) => typeof v === "string" && Array.from(v).length <= max &&
    (empty || !!v.trim()) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
function requireValue(ok) { if (!ok)
    throw new Error("Invalid or oversized agent question/answer."); }
function fields(v, names) {
    requireValue(object(v) && Object.keys(v).length === names.length && names.every(name => Object.hasOwn(v, name)));
}
function canonical(v) {
    return JSON.stringify(v && typeof v === "object" ? Array.isArray(v) ? v.map(item => JSON.parse(canonical(item))) :
        Object.fromEntries(Object.keys(v).sort().map(key => [key, JSON.parse(canonical(v[key]))])) : v);
}
function isQuestionSchema(v) { try {
    return canonical(v) === canonical(exports.QUESTION_SCHEMA);
}
catch {
    return false;
} }
/** Duplicate keys are rejected at every nesting level, unlike JSON.parse alone. */
function strictInteractionJson(raw) {
    requireValue(text(raw, 16_384) && new TextEncoder().encode(raw).length <= 16_384);
    let index = 0;
    let nodes = 0;
    const skip = () => { while (index < raw.length && /[ \t\r\n]/.test(raw[index]))
        index++; };
    const token = () => { const match = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(raw.slice(index)); requireValue(match); index += match[0].length; return JSON.parse(match[0]); };
    const value = (depth) => {
        requireValue(depth <= 8 && ++nodes <= 256);
        skip();
        if (raw[index] === '"')
            return token();
        if (raw[index] === "{") {
            index++;
            skip();
            const result = Object.create(null);
            if (raw[index] !== "}")
                for (;;) {
                    const key = token();
                    requireValue(!Object.hasOwn(result, key));
                    skip();
                    requireValue(raw[index++] === ":");
                    result[key] = value(depth + 1);
                    skip();
                    if (raw[index] === "}")
                        break;
                    requireValue(raw[index++] === ",");
                    skip();
                }
            index++;
            return result;
        }
        if (raw[index] === "[") {
            index++;
            skip();
            const result = [];
            if (raw[index] !== "]")
                for (;;) {
                    result.push(value(depth + 1));
                    skip();
                    if (raw[index] === "]")
                        break;
                    requireValue(raw[index++] === ",");
                }
            index++;
            return result;
        }
        const match = /^(?:true|false|-?(?:0|[1-9]\d*))(?=[ \t\r\n]*[,}\]])/.exec(raw.slice(index));
        requireValue(match);
        index += match[0].length;
        return JSON.parse(match[0]);
    };
    const result = value(0);
    skip();
    requireValue(index === raw.length);
    return result;
}
function parseQuestionForm(raw) {
    const value = strictInteractionJson(raw);
    fields(value, ["questions"]);
    requireValue(Array.isArray(value.questions) && value.questions.length >= 1 && value.questions.length <= 4);
    for (const question of value.questions) {
        fields(question, ["header", "question", "multiple", "options"]);
        requireValue(text(question.header, 30) && text(question.question, 2000) && typeof question.multiple === "boolean" && Array.isArray(question.options) && question.options.length <= 8);
        const labels = new Set();
        for (const option of question.options) {
            fields(option, ["label", "description"]);
            requireValue(text(option.label, 60) && text(option.description, 300, true) && !labels.has(option.label));
            labels.add(option.label);
        }
    }
    return JSON.parse(JSON.stringify(value));
}
function validateQuestionDecision(challenge, value) {
    fields(value, ["version", "id", "cancelled", "answers"]);
    requireValue(value.version === 1 && value.id === challenge.id && typeof value.cancelled === "boolean" && Array.isArray(value.answers));
    if (value.cancelled)
        requireValue(value.answers.length === 0);
    else {
        requireValue(value.answers.length === challenge.form.questions.length);
        value.answers.forEach((answer, index) => {
            fields(answer, ["selected", "custom"]);
            const question = challenge.form.questions[index];
            requireValue(Array.isArray(answer.selected) && answer.selected.length <= question.options.length && new Set(answer.selected).size === answer.selected.length &&
                answer.selected.every(item => Number.isInteger(item) && item >= 0 && item < question.options.length) && text(answer.custom, 4000, true));
            const count = answer.selected.length + (answer.custom.trim() ? 1 : 0);
            requireValue(count > 0 && (question.multiple || count === 1));
        });
    }
    requireValue(new TextEncoder().encode(JSON.stringify(value)).length <= 16_384);
    return JSON.parse(JSON.stringify(value));
}
