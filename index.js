const fs = require("fs");
const path = require("path");
const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const PluralCategories = require("make-plural/pluralCategories");

function translationExtractor(options = {}) {
	const { srcPath = "src", translationsPath = "public/translations", languages = ["en", "it"], functionName = "t", verbose = false } = options;

	const pluralCategories = {};
	languages.forEach((lang) => {
		if (PluralCategories[lang]) {
			pluralCategories[lang] = PluralCategories[lang].cardinal;
		} else {
			pluralCategories[lang] = ["other"]; // Usa 'other' se la lingua non è supportata
		}
	});

	return {
		name: "vite-plugin-translation-extractor",
		handleHotUpdate({ file }) {
			console.log(`handleHotUpdate chiamato per il file: ${file}`);
			if (isJavaScriptFile(file) && file.startsWith(path.resolve(process.cwd(), srcPath))) {
				console.log(`Processo il file: ${file}`);
				if (verbose) {
					console.log(`File modificato: ${file}`);
				}

				const keys = extractKeysFromFile(file);
				const allKeys = new Map();
				mergeKeys(allKeys, keys);
				updateTranslations(allKeys, translationsPath, languages, pluralCategories, verbose);
			}
		},
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

			updateTranslations(allKeys, translationsPath, languages, pluralCategories, verbose);
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

		const keys = new Map(); // Map<context, Map<key, { plurals: boolean, params: Set<string> }>>

		traverse(ast, {
			CallExpression({ node }) {
				const calleeName = node.callee.name || (node.callee.property && node.callee.property.name);

				if (calleeName === functionName && node.arguments.length > 0) {
					const [keyArg, optionsArg] = node.arguments;
					let key = "";
					let hasPlural = false;
					const params = new Set();
					let context = "default";

					// Estrai la chiave
					if (keyArg.type === "StringLiteral") {
						key = keyArg.value;
					} else if (keyArg.type === "TemplateLiteral") {
						key = keyArg.quasis.map((quasi) => quasi.value.cooked).join("${}");
					} else {
						return;
					}

					// Estrai i parametri e il contesto
					if (optionsArg && optionsArg.type === "ObjectExpression") {
						optionsArg.properties.forEach((prop) => {
							const propName = prop.key.name || prop.key.value; // Gestisce anche chiavi computate
							if (propName === "count") {
								hasPlural = true;
								params.add("count");
							} else if (propName === "context") {
								if (prop.value.type === "StringLiteral") {
									context = prop.value.value;
								}
							} else {
								params.add(propName);
							}
						});
					}

					if (!keys.has(context)) {
						keys.set(context, new Map());
					}
					const contextKeys = keys.get(context);
					if (!contextKeys.has(key)) {
						contextKeys.set(key, { plurals: hasPlural, params });
					} else {
						const existing = contextKeys.get(key);
						existing.plurals = existing.plurals || hasPlural;
						existing.params = new Set([...(existing.params instanceof Set ? existing.params : []), ...value.params]);
						contextKeys.set(key, existing);
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
	function updateTranslations(keys, translationsPath, languages, pluralCategories, verbose) {
		const absTranslationsPath = path.resolve(process.cwd(), translationsPath);

		keys.forEach((contextKeys, context) => {
			languages.forEach((lang) => {
				let translationDir = absTranslationsPath;
				if (context !== "default") {
					translationDir = path.join(absTranslationsPath, context);
				}

				if (!fs.existsSync(translationDir)) {
					fs.mkdirSync(translationDir, { recursive: true });
				}

				const translationFile = path.join(translationDir, `${lang}.json`);
				let translations = {};

				// Se il file esiste, leggilo
				if (fs.existsSync(translationFile)) {
					translations = JSON.parse(fs.readFileSync(translationFile, "utf-8"));
				}

				let updated = false;

				contextKeys.forEach((value, key) => {
					if (value.plurals) {
						// Genera le chiavi per le forme plurali
						const pluralForms = pluralCategories[lang];
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
		});
	}
}

module.exports = translationExtractor;
