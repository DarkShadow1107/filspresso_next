"use client";
import * as React from "react";
import { validateQuestionDecision, type QuestionAnswer, type QuestionChallenge, type QuestionDecision } from "@/lib/playgroundQuestions";

/** Keyed by interaction ID. Selection and free text are inert clarification, never consent. */
export default function PlaygroundAgentQuestion({ challenge, answer }: { challenge: QuestionChallenge; answer: (value: QuestionDecision) => unknown }) {
	const [answers, setAnswers] = React.useState<QuestionAnswer[]>(() => challenge.form.questions.map(() => ({ selected: [], custom: "" })));
	const [sent, setSent] = React.useState(false);
	const decision: QuestionDecision = { version: 1, id: challenge.id, cancelled: false, answers };
	let valid = false; try { validateQuestionDecision(challenge, decision); valid = true; } catch { /* Incomplete answers remain local. */ }
	const update = (index: number, value: QuestionAnswer) => setAnswers(previous => previous.map((item, current) => current === index ? value : item));
	return <form aria-label="Agent clarification questions" className="pgw-recorded-event" onSubmit={event => { event.preventDefault(); if (valid && !sent) { setSent(true); answer(decision); } }}>
		<h2>The agent has questions</h2><p>Answers clarify your request. They do not approve file changes or commands.</p>
		{challenge.form.questions.map((question, index) => <fieldset key={index} disabled={sent}>
			<legend>{question.header}: {question.question}</legend><p>{question.multiple ? "Choose one or more, or type your own answer." : "Choose one, or type your own answer."}</p>
			{question.options.map((option, optionIndex) => <label key={optionIndex} style={{ display: "block" }}>
				<input type={question.multiple ? "checkbox" : "radio"} name={`${challenge.id}-${index}`} checked={answers[index].selected.includes(optionIndex)} onChange={event => update(index, {
					selected: question.multiple ? event.target.checked ? [...answers[index].selected, optionIndex] : answers[index].selected.filter(item => item !== optionIndex) : [optionIndex], custom: question.multiple ? answers[index].custom : "",
				})} /> {option.label}{option.description && ` — ${option.description}`}
			</label>)}
			<label>Your own answer<textarea aria-label={`Your own answer: ${question.header}`} maxLength={4000} value={answers[index].custom} onChange={event => update(index, { selected: question.multiple ? answers[index].selected : [], custom: event.target.value })} /></label>
		</fieldset>)}
		<button type="submit" className="pgw-outlined-button" disabled={!valid || sent}>Submit answers</button>
		<button type="button" className="pgw-text-button" disabled={sent} onClick={() => { setSent(true); answer({ version: 1, id: challenge.id, cancelled: true, answers: [] }); }}>Dismiss and stop</button>
	</form>;
}
