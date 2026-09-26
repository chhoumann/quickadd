// Geocodes an address with OpenStreetMap's free Nominatim API and stores the
// coordinates in the active note's `location` property as `lat,lng`, the
// front matter format that the Map View plugin reads and writes itself.
module.exports = async (params) => {
    const {app, obsidian, quickAddApi} = params;

    // The note open when the macro starts is the one that gets the location.
    // Capture it now: the prompt's Peek lets the user open other notes (for
    // example to copy the address) before submitting.
    const activeFile = app.workspace.getActiveFile();
    if (!activeFile) {
        new obsidian.Notice("No active file", 5000);
        return;
    }

    const address = await quickAddApi.inputPrompt(`🏠 Address for ${activeFile.path}`);
    if (!address) {
        new obsidian.Notice("No address given", 5000);
        return;
    }

    let results;
    try {
        results = await geocode(obsidian, address);
    } catch (error) {
        console.error("getLongLatFromAddress: geocoding failed", error);
        new obsidian.Notice(`Could not look up "${address}": ${error?.message ?? error}`, 8000);
        return;
    }
    if (!results.length) {
        new obsidian.Notice(`No results found for "${address}"`, 5000);
        return;
    }

    const {lat, lon} = results[0];
    await app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
        frontmatter.location = `${lat},${lon}`;
    });
};

async function geocode(obsidian, address) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    // URLSearchParams encodes the address, so characters like `&` and `#`
    // stay part of the query instead of cutting it short.
    url.search = new URLSearchParams({q: address, format: "json", limit: "1"}).toString();

    const response = await obsidian.requestUrl({url: url.toString()});
    return response.json;
}
