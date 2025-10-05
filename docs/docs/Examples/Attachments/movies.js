const notice = (msg) => new Notice(msg, 5000);
const _log = (msg) => console.log(msg);

const API_KEY_OPTION = "OMDb API Key";
const API_URL = "https://www.omdbapi.com/";
const IMDB_BASE_URL = "https://www.imdb.com/title/";

module.exports = {
	entry: start,
	settings: {
		name: "Movie Script",
		author: "Christian B. B. Houmann",
		options: {
			[API_KEY_OPTION]: {
				type: "text",
				defaultValue: "",
				placeholder: "OMDb API Key",
			},
		},
	},
};

let QuickAdd;
let Settings;

async function start(params, settings) {
	QuickAdd = params;
	Settings = settings;

	const query = await QuickAdd.quickAddApi.inputPrompt(
		"Enter movie title or IMDB ID: "
	);
	if (!query) {
		notice("No query entered.");
		throw new Error("No query entered.");
	}

	let selectedShow;

	if (isImdbId(query)) {
		selectedShow = await getByImdbId(query);
	} else {
		const results = await getByQuery(query);

		const choice = await QuickAdd.quickAddApi.suggester(
			results.map(formatTitleForSuggestion),
			results
		);
		if (!choice) {
			notice("No choice selected.");
			throw new Error("No choice selected.");
		}

		selectedShow = await getByImdbId(choice.imdbID);
	}

	QuickAdd.variables = {
		...selectedShow,
		imdbUrl: IMDB_BASE_URL + selectedShow.imdbID,
		Released: formatDateString(selectedShow.Released),
		actorLinks: linkifyList(selectedShow.Actors.split(",")),
		genreLinks: linkifyList(selectedShow.Genre.split(",")),
		directorLink: linkifyList(selectedShow.Director.split(",")),
		fileName: replaceIllegalFileNameCharactersInString(selectedShow.Title),
		typeLink: `[[${selectedShow.Type === "movie" ? "Movies" : "Series"}]]`,
		languageLower: selectedShow.Language.toLowerCase(),
	};
}

function isImdbId(str) {
	return /^tt\d+$/.test(str);
}

function formatTitleForSuggestion(resultItem) {
	return `(${resultItem.Type === "movie" ? "M" : "TV"}) ${resultItem.Title} (${resultItem.Year})`;
}

function formatDateString(dateString) {
	if (!dateString || dateString === "N/A") return "";
	const parts = dateString.split(" ");
	if (parts.length !== 3) return dateString;
	const [day, month, year] = parts;
	const monthNames = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	const monthIndex = monthNames.indexOf(month);
	if (monthIndex < 0) return dateString;

	const date = new Date(Number(year), monthIndex, Number(day));
	if (Number.isNaN(date.getTime())) return dateString;

	// Format the date as yyyy-mm-dd
	const formattedYear = date.getFullYear();
	const formattedMonth = String(date.getMonth() + 1).padStart(2, "0");
	const formattedDay = String(date.getDate()).padStart(2, "0");

	return `${formattedYear}-${formattedMonth}-${formattedDay}`;
}

async function getByQuery(query) {
	const searchResults = await apiGet(API_URL, {
		s: query,
	});

	if (!searchResults.Search || !searchResults.Search.length) {
		notice("No results found.");
		throw new Error("No results found.");
	}

	return searchResults.Search;
}

async function getByImdbId(id) {
	const res = await apiGet(API_URL, {
		i: id,
	});

	if (!res) {
		notice("No results found.");
		throw new Error("No results found.");
	}

	return res;
}

function linkifyList(list) {
	if (!Array.isArray(list) || list.length === 0) return "";
	if (list.length === 1) return `\n  - "[[${list[0].trim()}]]"`;

	return list.map((item) => `\n  - "[[${item.trim()}]]"`).join("");
}

function replaceIllegalFileNameCharactersInString(input) {
	if (!input) return "";
	return input.replace(/[\\,#%&{}/*<>$'":@]/g, "").trim();
}

async function apiGet(_url, data) {
	const params = new URLSearchParams();
	if (data) {
		Object.entries(data).forEach(([key, value]) => {
			if (value != null && value !== "") params.append(key, String(value));
		});
	}

	const apiKey = Settings?.[API_KEY_OPTION];
	if (!apiKey || String(apiKey).trim() === "") {
		notice("Please set your OMDb API key in the script settings.");
		throw new Error("Missing OMDb API key.");
	}
	params.append("apikey", String(apiKey).trim());

	const href = `${API_URL}?${params.toString()}`;
	const res = await request({
		url: href,
		method: "GET",
		cache: "no-cache",
		headers: {
			"Content-Type": "application/json",
		},
	});

	return JSON.parse(res);
}
