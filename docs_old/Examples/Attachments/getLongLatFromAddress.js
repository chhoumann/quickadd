module.exports = async (params) => {
    const {createYamlProperty} = params.app.plugins.plugins["metaedit"].api;
    const address = await params.quickAddApi.inputPrompt("🏠 Address");
    if (!address) {
        new Notice("No address given", 5000);
        return;
    }

    const result = await apiGet(address);
    if (!result.length) {
        new Notice("No results found", 5000);
        return;
    }

    const {lat, lon} = result[0];

    const activeFile = params.app.workspace.getActiveFile();
    if (!activeFile) {
        new Notice("No active file", 5000);
        return;
    }

    await createYamlProperty("location", `[${lat}, ${lon}]`, activeFile);
}


async function apiGet(searchQuery) {
    let finalURL = new URL(`https://nominatim.openstreetmap.org/search?q=${searchQuery}&format=json`);
    
    return await fetch(finalURL, {
        method: 'GET', cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
        },
    }).then(async (res) => await res.json());
}