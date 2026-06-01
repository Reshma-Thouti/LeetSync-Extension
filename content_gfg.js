console.log("LeetSync: Content script successfully loaded on GeeksforGeeks!");
// ----- ACCOUNT LOCK -----
const MY_GFG_USERNAME = "thoutir1z1v";

async function verifyGfgUser() {
    try {

        const profileLink =
            document.querySelector('a[href*="/profile/"]');

        if (!profileLink) {
            console.log(
                "LeetSync: Could not find GFG profile."
            );
            return false;
        }

        const href =
            profileLink.getAttribute("href") || "";

        const match =
            href.match(/profile\/([^/?]+)/);

        const currentUser =
            match ? match[1] : null;

        console.log(
            "LeetSync:",
            "Logged GFG User =",
            currentUser
        );

        return currentUser === MY_GFG_USERNAME;

    } catch(err){
        console.error(err);
        return false;
    }
}
const startGfgObserver = () => {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (document.body.innerText.includes("Problem Solved Successfully") ||
                document.body.innerText.includes("Correct Answer")) {

                console.log("LeetSync: GFG SUCCESS DETECTED! Waiting for DOM to settle...");
                observer.disconnect();

                // Increased timeout slightly to ensure React has fully re-rendered the success panel
                setTimeout(extractGfgData, 2000);
                return;
            }
        }
    });

    const outputContainer = document.querySelector('.problem-tab__container') || document.body;
    observer.observe(outputContainer, { childList: true, subtree: true });
};

const extractGfgData = () => {
    try {
        // 1. Get Title
        const titleElement = document.querySelector('div[class^="problems_header_content"] h3') || document.querySelector('h3');
        const title = titleElement ? titleElement.innerText.trim() : document.title.split('|')[0].trim();

        // 2. Get Code
        const codeElements = document.querySelectorAll('.view-line');
        let code = Array.from(codeElements).map(el => el.innerText).join('\n');
        if (!code || code.length < 5) {
            const aceLines = document.querySelectorAll('.ace_line');
            code = Array.from(aceLines).map(el => el.innerText).join('\n');
        }

        // 3. Get Description
        const descElement = document.querySelector('div[class^="problems_problem_content"]');
        const description = descElement ? descElement.innerHTML : "Description not found";

        // 4. Get URL
        const problemUrl = window.location.href.split('?')[0];

        // 5. Multi-Strategy Difficulty Extraction
        let difficulty = "Uncategorized";
        const validDifficulties = ["School", "Basic", "Easy", "Medium", "Hard"];

        // Strategy A: Direct Class Target (Fastest)
        const diffElement = document.querySelector('div[class*="difficulty"] span, span[class*="difficulty"], .problem-difficulty');
        if (diffElement) {
            const text = diffElement.innerText.trim();
            const match = validDifficulties.find(d => text.toLowerCase().includes(d.toLowerCase()));
            if (match) difficulty = match;
        }

        // Strategy B: Aggressive DOM Regex Crawler (Bulletproof Fallback)
        if (difficulty === "Uncategorized") {
            console.log("LeetSync: Direct target failed, initiating deep DOM scan for difficulty...");
            // Grab literally every text-holding element
            const allSmallElements = document.querySelectorAll('span, div, p, strong, b, h3, h4');

            for (let el of allSmallElements) {
                const text = el.innerText.trim();

                // Only check elements with short text to avoid scanning entire problem descriptions
                if (text.length > 0 && text.length < 30) {
                    for (let diff of validDifficulties) {
                        // Regex \b matches word boundaries (so "Easy" matches, but "Uneasy" does not)
                        const regex = new RegExp(`\\b${diff}\\b`, "i");
                        if (regex.test(text)) {
                            // Ensure it's a leaf node (no children) or explicitly says "Difficulty"
                            // This stops us from accidentally grabbing the word "hard" if it's in the problem title
                            if (el.children.length === 0 || text.toLowerCase().includes("difficulty")) {
                                difficulty = diff;
                                break;
                            }
                        }
                    }
                }
                if (difficulty !== "Uncategorized") break;
            }
        }

        // 6. Get Language
        const langDropdown = document.querySelector('.divider.text.dropdown');
        const rawLanguage = langDropdown ? langDropdown.innerText.toLowerCase() : 'java';

        let languageFolder = "Unknown";
        let fileExtension = ".txt";

        // Defaulting the scrape check to align with your primary development environment
        if (rawLanguage.includes("java")) {
            languageFolder = "Java";
            fileExtension = ".java";
        } else if (rawLanguage.includes("python")) {
            languageFolder = "Python";
            fileExtension = ".py";
        } else if (rawLanguage.includes("c++") || rawLanguage.includes("cpp")) {
            languageFolder = "C++";
            fileExtension = ".cpp";
        } else if (rawLanguage.includes("c")) {
            languageFolder = "C";
            fileExtension = ".c";
        } else {
            languageFolder = rawLanguage.charAt(0).toUpperCase() + rawLanguage.slice(1);
            fileExtension = `.${rawLanguage}`;
        }

        // 7. Get Metrics
        let runtime = "Successfully Evaluated";
        let memory = "N/A";
        const timeElement = document.querySelector('.execution-time');
        if (timeElement) runtime = timeElement.innerText.trim();

        console.log(`LeetSync: Scraped GFG. Diff: ${difficulty}, Lang: ${languageFolder}`);
        const isMine = await verifyGfgUser();

        if (!isMine) {

            console.log(
                "LeetSync: Wrong GFG account. Sync blocked."
            );

            alert(
                "LeetSync: Wrong GFG account detected. Sync cancelled."
            );

            return;
        }
        chrome.runtime.sendMessage({
            type: "SUBMISSION_ACCEPTED",
            payload: {
                platform: "GeeksforGeeks",
                title: title,
                problemUrl: problemUrl,
                description: description,
                code: code,
                difficulty: difficulty,
                languageFolder: languageFolder,
                fileExtension: fileExtension,
                tags: "GFG Problem",
                runtime: runtime,
                memory: memory
            }
        });
    } catch (error) {
        console.error("LeetSync: Failed to scrape GFG data", error);
    }
};

setTimeout(startGfgObserver, 3000);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "FORCE_SYNC") {
        console.log("LeetSync: Manual GFG sync triggered!");
        extractGfgData();
        sendResponse({status: "success"});
    }
});