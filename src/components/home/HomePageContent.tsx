import CoffeeMachineScene from "./CoffeeMachineScene";
import WeatherWidget from "@/components/WeatherWidget";

export default function HomePageContent() {
	return (
		<main className="legacy-home">
			<CoffeeMachineScene />
			<div className="home-weather-widget">
				<WeatherWidget showRecommendation />
			</div>
			<div className="unselect hero-spacer" aria-hidden="true">
				1
			</div>
			<div className="home-text-spacer" aria-hidden="true"></div>
			<h3 className="h3_home">
				Bienvenue chez Filspresso, votre voyage quotidien vers la joie du café et le raffinement des arômes ! Dans notre
				monde digital, nous vous invitons à explorer les subtilités du café, où chaque tasse a une histoire à raconter et
				chaque gorgée est une danse de l’expérience.
			</h3>
			<h4 className="h3_home">
				Les mots sont limités pour décrire la profondeur et l’intensité de la passion du café car, comme le disait Balzac
				: « Le café est une passion qui ne peut être décrite avec des mots », étant essentiellement une source
				d’inspiration, une expérience profonde et une passion qu’elle dépasse notre capacité à le percevoir et à
				l’exprimer.
			</h4>
		</main>
	);
}
