"use client";
import { motion } from "motion/react";
import CoffeeMachineSceneClient from "./CoffeeMachineSceneClient";
import WeatherWidget from "@/components/WeatherWidget";

const sections = [
	{
		title: "Filspresso : L'alchimie entre le code et l'arabica.",
		text: "Dans le silence feutré de votre espace de travail, entre deux lignes de code complexes et l'exécution d'un script vital, se trouve une vérité universelle : l'excellence logicielle exige une muse à sa mesure. Filspresso transcende la simple consommation pour devenir votre partenaire de développement, transformant chaque pause en une expérience sensorielle où la précision de l'ingénierie rencontre la richesse inégalée de nos crus d'exception."
	},
	{
		title: "Logique et Arômes : Une danse de précision.",
		text: "Le développement est une danse entre logique et créativité, tout comme l'art du café exige rigueur et passion. Nos sélections, méticuleusement sourcées, sont pensées pour accompagner vos sessions de debugging les plus intenses, offrant cette clarté mentale indispensable pour résoudre les problèmes les plus opaques. Ici, chaque grain raconte une histoire de terroir, chaque torréfaction est un hommage à la patience, et chaque tasse est une invitation à revisiter votre créativité."
	},
	{
		title: "L'impulsion de votre productivité.",
		text: "Rejoignez une communauté où la maîtrise technologique s'allie au raffinement gustatif. Que vous soyez en phase d'architecture système ou en plein déploiement, Filspresso est l'impulsion nécessaire pour transformer votre flux de travail en une symphonie de productivité. Laissez-vous porter par la complexité de nos arômes, car après tout, la perfection d'un système est aussi exigeante que celle d'un espresso."
	}
];
export default function HomePageContent() {
	return (
		<main className="legacy-home" style={{ position: "relative" }}>
			<div style={{ position: "relative", minHeight: "100vh" }}>
				<div style={{ position: "absolute", top: "12vh", right: "20px", zIndex: 10 }}>
					<WeatherWidget showRecommendation />
				</div>
				<div style={{ 
					minHeight: "100vh", 
					display: "flex", 
					alignItems: "flex-start", 
					paddingTop: "15vh",
					justifyContent: "center" 
				}}>
					<CoffeeMachineSceneClient />
				</div>
			</div>

			<div style={{ paddingBottom: "10vh" }}>
				{sections.map((section, index) => (
					<section
						key={index}
						style={{ 
							minHeight: "80vh", 
							display: "flex", 
							flexDirection: "column", 
							justifyContent: "center",  
							maxWidth: "1200px", 
							margin: "0 auto" 
						}}
					>
						<motion.h3 
							className="text-metallic" 
							initial={{ opacity: 0, y: 30 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: false, amount: 0.5 }}
							transition={{ duration: 0.6, ease: "easeOut" }}
							style={{ fontSize: "3.5rem", marginBottom: "40px", textAlign: "left" }}
						>
							{section.title}
						</motion.h3>
						<motion.p 
							initial={{ opacity: 0, y: 30 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: false, amount: 0.3 }}
							transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
							style={{ fontSize: "1.75rem", lineHeight: "1.8", color: "#f8dccb", textAlign: "left" }}
						>
							{section.text}
						</motion.p>
					</section>
				))}
			</div>
		</main>
	);
}
