const fs = require("fs");
const path = require("path");
const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const { PluralCategories, getPluralRules } = require("make-plural/pluralCategories");

function translationExtractor(options = {}) {
	const { srcPath = "src", translationsPath = "public/translations", languages = ["en", "it"], functionName = "t", verbose = false } = options;

	const pluralRules = {};
	languages.forEach((lang) => {
		pluralRules[lang] = getPluralRules(lang);
	});

	return {
		name: "vite-plugin-translation-extractor",
		apply: "build",
		buildStart() {
			if (verbose) {
				console.log("Inizio estrazione delle traduzioni...");
			}
			const files = getJsFiles(srcPath);
			let allKeys = new Map();

			files.forEach((file) => {
				const keys = extractKeysFromFile(file);
				mergeKeys(allKeys, keys);
			});

			updateTranslations(allKeys, translationsPath, languages, pluralRules, verbose);
		},
	};

	// Funzione per leggere tutti i file JavaScript ricorsivamente
	function getJsFiles(dir, files_) {
		files_ = files_ || [];
		const files = fs.readdirSync(dir);
		for (let i in files) {
			const name = path.join(dir, files[i]);
			if (fs.statSync(name).isDirectory()) {
				getJsFiles(name, files_);
			} else if (isJavaScriptFile(name)) {
				files_.push(name);
			}
		}
		return files_;
	}

	// Funzione per verificare se un file è JavaScript/TypeScript
	function isJavaScriptFile(file) {
		return file.endsWith(".js") || file.endsWith(".jsx") || file.endsWith(".ts") || file.endsWith(".tsx");
	}

	// Funzione per estrarre le chiavi dalle chiamate a t()
	function extractKeysFromFile(filePath) {
		const code = fs.readFileSync(filePath, "utf-8");
		const ast = babelParser.parse(code, {
			sourceType: "module",
			plugins: ["jsx", "typescript"],
		});

		const keys = new Map(); // Map<chiaveBase, { plurals: boolean, params: Set<string> }>

		traverse(ast, {
			CallExpression({ node }) {
				const calleeName = node.callee.name || (node.callee.property && node.callee.property.name);

				if (calleeName === functionName && node.arguments.length > 0) {
					const [keyArg, optionsArg] = node.arguments;
					let key = "";
					let hasPlural = false;
					const params = new Set();

					// Estrae la chiave
					if (keyArg.type === "StringLiteral") {
						key = keyArg.value;
					} else if (keyArg.type === "TemplateLiteral") {
						key = keyArg.quasis.map((quasi) => quasi.value.cooked).join("${}");
					} else {
						return;
					}

					// Estrae i parametri
					if (optionsArg && optionsArg.type === "ObjectExpression") {
						optionsArg.properties.forEach((prop) => {
							if (prop.key.name === "count") {
								hasPlural = true;
								params.add("count");
							} else if (prop.key.name !== "context") {
								params.add(prop.key.name);
							}
						});
					}

					if (!keys.has(key)) {
						keys.set(key, { plurals: hasPlural, params });
					} else {
						const existing = keys.get(key);
						existing.plurals = existing.plurals || hasPlural;
						existing.params = new Set([...existing.params, ...params]);
						keys.set(key, existing);
					}
				}
			},
		});

		return keys;
	}

	// Funzione per unire le chiavi estratte
	function mergeKeys(allKeys, newKeys) {
		newKeys.forEach((value, key) => {
			if (!allKeys.has(key)) {
				allKeys.set(key, value);
			} else {
				const existing = allKeys.get(key);
				existing.plurals = existing.plurals || value.plurals;
				existing.params = new Set([...existing.params, ...value.params]);
				allKeys.set(key, existing);
			}
		});
	}

	// Funzione per aggiornare i file di traduzione
	function updateTranslations(keys, translationsPath, languages, pluralRules, verbose) {
		const absTranslationsPath = path.resolve(process.cwd(), translationsPath);

		languages.forEach((lang) => {
			const translationFile = path.join(absTranslationsPath, `${lang}.json`);
			let translations = {};

			// Se il file esiste, leggilo
			if (fs.existsSync(translationFile)) {
				translations = JSON.parse(fs.readFileSync(translationFile, "utf-8"));
			}

			let updated = false;

			keys.forEach((value, key) => {
				if (value.plurals) {
					// Genera le chiavi per le forme plurali
					const pluralForms = pluralRules[lang];
					pluralForms.forEach((form) => {
						const pluralKey = `${key}_${form}`;
						if (!translations.hasOwnProperty(pluralKey)) {
							translations[pluralKey] = ""; // Aggiungi la chiave con valore vuoto
							updated = true;
						}
					});
				} else {
					if (!translations.hasOwnProperty(key)) {
						translations[key] = ""; // Aggiungi la chiave con valore vuoto
						updated = true;
					}
				}
			});

			if (updated) {
				// Ordina le chiavi alfabeticamente
				const sortedTranslations = {};
				Object.keys(translations)
					.sort()
					.forEach((key) => {
						sortedTranslations[key] = translations[key];
					});

				fs.writeFileSync(translationFile, JSON.stringify(sortedTranslations, null, 2), "utf-8");
				if (verbose) {
					console.log(`Aggiornato ${translationFile}`);
				}
			} else if (verbose) {
				console.log(`Nessun aggiornamento necessario per ${translationFile}`);
			}
		});
	}
}

module.exports = translationExtractor;
