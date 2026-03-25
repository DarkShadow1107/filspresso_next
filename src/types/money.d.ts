declare module "money" {
	type Converter = {
		from(code: string): {
			to(code: string): number;
		};
	};

	type MoneyStatic = {
		(value: number): Converter;
		base: string;
		rates: Record<string, number>;
	};

	const fx: MoneyStatic;
	export default fx;
}
