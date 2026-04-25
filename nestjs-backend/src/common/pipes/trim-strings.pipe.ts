import { Injectable, PipeTransform } from "@nestjs/common";

function trimDeep(value: unknown): unknown {
	if (typeof value === "string") {
		return value.trim();
	}

	if (Array.isArray(value)) {
		return value.map((entry) => trimDeep(entry));
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).map(([key, innerValue]) => [key, trimDeep(innerValue)]);
		return Object.fromEntries(entries);
	}

	return value;
}

@Injectable()
export class TrimStringsPipe implements PipeTransform {
	transform(value: unknown): unknown {
		return trimDeep(value);
	}
}
