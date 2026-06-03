
// ============================================================================
// LEETSYNC CONTENT SCRIPT (content.js)
// ----------------------------------------------------------------------------
// This script runs directly on LeetCode problem pages. It is responsible for
// detecting when a problem is solved, bypassing DOM virtualization to extract
// the full code, parsing the problem details, and sending it to the background.
// ============================================================================

console.log("LeetSync: Content script successfully loaded on LeetCode!");
// ----- ACCOUNT LOCK -----
const MY_LEETCODE_USERNAME = "QOZ0Uqd6qe";

async function verifyLeetCodeUser() {
    try {

        const profileLink =
            document.querySelector('a[href^="/u/"]') ||
            document.querySelector('a[href*="/u/"]');

        if (!profileLink) {
            console.log("LeetSync: Could not find LC profile.");
            return false;
        }

        const href = profileLink.getAttribute("href") || "";

        const currentUser =
            href.split("/u/")[1]?.replace(/\//g, "");

        console.log(
            "LeetSync:",
            "Logged User =", currentUser
        );

        return currentUser === MY_LEETCODE_USERNAME;

    } catch(err){
        console.error(err);
        return false;
    }
}
// ----------------------------------------------------------------------------
// 1. ADVANCED EXTRACTION ENGINE
// Bypasses Monaco Editor virtualization by injecting a script into the MAIN world.
// ----------------------------------------------------------------------------
const extractFullCode = async () => {
    return new Promise((resolve) => {
        // Listen for the injected script's response
        const listener = (event) => {
            if (event.source !== window || !event.data || event.data.type !== 'LEETSYNC_CODE_RESPONSE') return;
            window.removeEventListener('message', listener);
            resolve(event.data.code);
        };
        window.addEventListener('message', listener);

        // Inject a script into LeetCode's main environment to read internal variables
        const script = document.createElement('script');
        script.textContent = `
            (function() {
                let extractedCode = "";
                try {
                    // Attempt 1: Access Monaco Editor directly
                    if (window.monaco && window.monaco.editor) {
                        const models = window.monaco.editor.getModels();
                        if (models.length > 0) extractedCode = models[0].getValue();
                    }
                    
                    // Attempt 2: Traverse React Fiber Tree (For LeetCode's newer UI)
                    if (!extractedCode) {
                        const editorNodes = document.querySelectorAll('.monaco-editor, .react-codemirror2');
                        for (let el of editorNodes) {
                            const reactKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
                            if (reactKey) {
                                let node = el[reactKey];
                                while (node) {
                                    if (node.memoizedProps && node.memoizedProps.value) {
                                        extractedCode = node.memoizedProps.value;
                                        break;
                                    }
                                    node = node.return;
                                }
                            }
                            if (extractedCode) break;
                        }
                    }
                } catch (e) {
                    console.error("LeetSync Inline Script Error:", e);
                }
                // Send the raw code back to the extension
                window.postMessage({ type: 'LEETSYNC_CODE_RESPONSE', code: extractedCode }, '*');
            })();
        `;
        document.documentElement.appendChild(script);
        script.remove(); // Clean up traces

        // Safety Net: If the script fails, resolve null after 1 second so we can fallback
        setTimeout(() => {
            window.removeEventListener('message', listener);
            resolve(null);
        }, 1000);
    });
};

// ----------------------------------------------------------------------------
// 2. ACTIVE SUBMISSION OBSERVER
// Watches the page for a successful "Submit" action (ignores basic "Run" actions).
// ----------------------------------------------------------------------------
const startObserver = () => {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            // Broad check for "Accepted" plus performance metrics to confirm a real submission
            const bodyText = document.body.innerText || "";
            if (bodyText.includes("Accepted") && (bodyText.includes("Runtime") || bodyText.includes("Beats") || bodyText.includes("Memory"))) {

                // Safely check elements without crashing on SVGs (using innerText fallback)
                const resultElements = document.querySelectorAll('.text-green-s, .text-dark-green-s, .bg-green-s, .text-sd-green-s, [data-e2e-locator="submission-result"]');
                let isActuallyAccepted = false;

                for (let el of resultElements) {
                    if ((el.innerText || "").includes("Accepted")) {
                        isActuallyAccepted = true;
                        break;
                    }
                }

                if (isActuallyAccepted) {
                    console.log("LeetSync: SUCCESS DETECTED! Asking background to fetch full code...");
                    observer.disconnect();

                    // Give LeetCode's UI and React state 1.5 seconds to settle before extracting
                    setTimeout(() => { extractData(); }, 1500);
                    return;
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
};

// ----------------------------------------------------------------------------
// 3. CORE DATA EXTRACTOR
// Scrapes the problem title, description, tags, performance, and requests the code.
// ----------------------------------------------------------------------------
const extractData = async () => {
    try {
        // --- 3A. TITLE EXTRACTION ---
        let title = document.title.split('-')[0].trim();
        const titleEl = document.querySelector('a[href*="/problems/"][class*="font-semibold"]');
        if (titleEl && titleEl.innerText) title = titleEl.innerText.replace(/^\d+\.\s*/, '').trim();

        // --- 3B. CODE EXTRACTION ---
        // Ask the background script to securely fetch the full code via Manifest V3 scripting
        let code = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "GET_FULL_CODE" }, (response) => {
                resolve(response ? response.code : null);
            });
        });

        // Fallback: If injection fails, grab whatever is visible on screen
        if (!code || code.length < 5) {
            console.log("LeetSync: Falling back to DOM scraping for code.");
            const codeElements = document.querySelectorAll('.view-line');
            code = Array.from(codeElements).map(el => el.innerText).join('\n');

            if (!code || code.length < 5) {
                const fallbackCode = document.querySelector('code');
                if (fallbackCode) code = fallbackCode.innerText;
            }
        }

        if (!code) code = "// Error: Could not extract code from LeetCode editor.";

        // --- 3C. DESCRIPTION & URL EXTRACTION ---
        const descElement = document.querySelector('[data-track-load="description_content"]') || document.querySelector('div[class*="elfjS"]');
        const description = descElement ? descElement.innerHTML : "Description not found";
        const problemUrl = window.location.href.split('/submissions')[0].split('/description')[0];

        // --- 3D. DIFFICULTY EXTRACTION (Top-Down Priority) ---
        let difficulty = "Uncategorized";

        // Pass ALL classes into one querySelector to get the VERY FIRST match on the page.
        // This guarantees we grab the actual difficulty at the top, ignoring "Similar Questions".
        const diffElement = document.querySelector('.text-difficulty-easy, .text-sd-easy, .bg-sd-easy, [class*="text-olive"], .text-difficulty-medium, .text-sd-medium, .bg-sd-medium, [class*="text-yellow"], .text-difficulty-hard, .text-sd-hard, .bg-sd-hard, [class*="text-pink"]');

        if (diffElement) {
            const cls = diffElement.className.toLowerCase();
            const txt = (diffElement.innerText || "").trim();
            if (cls.includes('easy') || cls.includes('olive') || txt === "Easy") difficulty = "Easy";
            else if (cls.includes('medium') || cls.includes('yellow') || txt === "Medium") difficulty = "Medium";
            else if (cls.includes('hard') || cls.includes('pink') || txt === "Hard") difficulty = "Hard";
        }

        // Fallback Strategy: Constrained DOM Scan (Only look near the title)
        if (difficulty === "Uncategorized") {
            const titleContainer = document.querySelector('a[href*="/problems/"][class*="font-semibold"]');
            const scanArea = titleContainer ? (titleContainer.closest('div.flex') || document.body) : document.body;

            const tags = scanArea.querySelectorAll('div, span');
            for (let el of tags) {
                const text = (el.innerText || "").trim();
                if (["Easy", "Medium", "Hard"].includes(text) && text.length < 10) {
                    difficulty = text;
                    break;
                }
            }
        }

        // Difficulty Session Memory Cache
        const diffCacheKey = `leetSync_diff_${problemUrl}`;
        if (difficulty !== "Uncategorized") {
            sessionStorage.setItem(diffCacheKey, difficulty);
        } else {
            const cachedDiff = sessionStorage.getItem(diffCacheKey);
            if (cachedDiff) {
                console.log(`LeetSync: Recovered difficulty '${cachedDiff}' from memory cache!`);
                difficulty = cachedDiff;
            }
        }

        // --- 3E. LANGUAGE & METADATA EXTRACTION ---
        const editorElement = document.querySelector('[data-mode-id]') || document.querySelector('button[id^="headlessui-listbox-button"]');
        let rawLanguage = editorElement ? (editorElement.getAttribute('data-mode-id') || editorElement.innerText).toLowerCase() : 'java';

        let languageFolder = "Unknown", fileExtension = ".txt";
        if (rawLanguage.includes("java") && !rawLanguage.includes("javascript")) { languageFolder = "Java"; fileExtension = ".java"; }
        else if (rawLanguage.includes("python")) { languageFolder = "Python"; fileExtension = ".py"; }
        else if (rawLanguage.includes("cpp") || rawLanguage.includes("c++")) { languageFolder = "C++"; fileExtension = ".cpp"; }
        else if (rawLanguage.includes("javascript") || rawLanguage.includes("js")) { languageFolder = "JavaScript"; fileExtension = ".js"; }
        else { languageFolder = rawLanguage.charAt(0).toUpperCase() + rawLanguage.slice(1); fileExtension = `.${rawLanguage}`; }

        const tagElements = document.querySelectorAll('a[href^="/tag/"]');
        const tags = Array.from(tagElements).map(el => (el.innerText || "").trim()).join(', ') || "No tags found";

        let runtime = "N/A", memory = "N/A";
        const statElements = document.querySelectorAll('.text-sd-green-s, span[class*="font-semibold text-green-s"]');
        if (statElements.length >= 2) {
            runtime = (statElements[0].innerText || "");
            memory = (statElements[1].innerText || "");
        } else if (document.body.innerText.includes("Beats")) {
            runtime = "Successfully Evaluated";
        }

        console.log(`LeetSync: LC Scraped. Diff: ${difficulty}, Lang: ${languageFolder}`);
        const isMine = await verifyLeetCodeUser();

        if (!isMine) {

            console.log(
                "LeetSync: Wrong LC account. Auto-sync blocked."
            );

            alert(
                "LeetSync: Wrong LeetCode account detected. Sync cancelled."
            );

            return;
        }
        // --- 3F. DISPATCH TO BACKGROUND SCRIPT ---
        chrome.runtime.sendMessage({
            type: "SUBMISSION_ACCEPTED",
            payload: {
                platform: "LeetCode",
                title: title,
                problemUrl: problemUrl,
                description: description,
                code: code,
                difficulty: difficulty,
                languageFolder: languageFolder,
                fileExtension: fileExtension,
                tags: tags,
                runtime: runtime,
                memory: memory
            }
        });
    } catch (error) {
        console.error("LeetSync: Failed to scrape LC data", error);
    }
};

// ----------------------------------------------------------------------------
// 4. HYBRID AUTO-SYNC (ON LOAD)
// Checks if the problem is already solved using GraphQL, falling back to UI polling.
// ----------------------------------------------------------------------------
const checkAlreadySolvedOnLoad = async () => {
    const currentUrl = window.location.href.split('/description')[0];
    // Prevent duplicate syncs in the same session
    if (sessionStorage.getItem(`leetSync_synced_${currentUrl}`)) return;

    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    const slug = match ? match[1] : null;
    let isSolved = false;

    // --- STEP 1: The GraphQL Database Check ---
    if (slug) {
        try {
            // Hijack the CSRF token to authenticate the API request
            const csrfToken = document.cookie.split('; ').find(row => row.startsWith('csrftoken='))?.split('=')[1];
            if (csrfToken) {
                const response = await fetch('https://leetcode.com/graphql', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-csrftoken': csrfToken
                    },
                    body: JSON.stringify({
                        query: `query questionStatus($titleSlug: String!) { question(titleSlug: $titleSlug) { status } }`,
                        variables: { titleSlug: slug },
                        operationName: "questionStatus"
                    })
                });

                const data = await response.json();
                if (data?.data?.question?.status === "ac") {
                    isSolved = true;
                    console.log("LeetSync: Database confirmed problem is 'Accepted'!");
                }
            }
        } catch (e) {
            console.log("LeetSync: API check failed. Dropping to UI Scanner.");
        }
    }

    // --- STEP 2: The Extraction Engine Waiter ---
    // Function that waits for the editor to load before triggering extraction
    const waitForEditorAndSync = () => {
        let attempts = 0;
        const waitForEditor = setInterval(() => {
            attempts++;
            const editorReady = document.querySelector('.monaco-editor, .react-codemirror2, [data-mode-id], .view-line, textarea');

            if (editorReady) {
                clearInterval(waitForEditor);
                console.log("LeetSync: Editor loaded. Auto-syncing past submission...");
                sessionStorage.setItem(`leetSync_synced_${currentUrl}`, "true");

                // Wait an extra 1.5s for React Fiber tree to hydrate the code
                setTimeout(() => { extractData(); }, 1500);
            } else if (attempts > 40) {
                // Give up after 20 seconds (useful for slow background tabs)
                clearInterval(waitForEditor);
                console.error("LeetSync: Editor took too long to load. Use Force Sync if needed.");
            }
        }, 500);
    };

    // --- STEP 3: Routing Logic ---
    if (isSolved) {
        // The API worked! Go straight to waiting for the editor.
        waitForEditorAndSync();
    } else {
        // The API failed or returned unsolved. Start the 15-second UI watch loop.
        let uiAttempts = 0;
        const waitForUI = setInterval(() => {
            uiAttempts++;
            let uiSolved = false;

            // Check for the green SVG checkmark next to the title
            if (document.querySelector('div.text-dark-green-s svg, svg.text-dark-green-s, [class*="text-dark-green"] svg, .text-sd-green-s svg')) {
                uiSolved = true;
            }

            // Check for the "Accepted" text badge (with SVG TypeError protection)
            const resultElements = document.querySelectorAll('[data-e2e-locator="submission-result"], .text-green-s, .bg-green-s, .text-sd-green-s');
            for (let el of resultElements) {
                if ((el.innerText || "").trim() === "Accepted") {
                    uiSolved = true;
                    break;
                }
            }

            if (uiSolved) {
                clearInterval(waitForUI);
                console.log("LeetSync: UI scanner confirmed problem is 'Accepted'!");
                waitForEditorAndSync();
            } else if (uiAttempts > 30) {
                clearInterval(waitForUI); // Give up after 15 seconds
            }
        }, 500);
    }
};

// ----------------------------------------------------------------------------
// 5. INITIALIZATION & LISTENERS
// ----------------------------------------------------------------------------

// Start the observer and the auto-sync check shortly after page load
setTimeout(startObserver, 2000);
setTimeout(checkAlreadySolvedOnLoad, 2500);

// Listen for the "Force Sync" button click from the popup UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === "FORCE_SYNC") {

        console.log(
            "LeetSync: Manual LC sync triggered!"
        );

        verifyLeetCodeUser()
        .then(isMine => {

            if(!isMine){

                console.log(
                    "LeetSync: Wrong account detected."
                );

                alert(
                    "LeetSync: This is NOT your LeetCode account."
                );

                sendResponse({
                    status:"blocked"
                });

                return;
            }

            extractData().then(() =>
                sendResponse({
                    status:"success"
                })
            );

        });

        return true;
    }
});