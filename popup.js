// Global UI Elements
const viewMain = document.getElementById("main-view");
const viewSettings = document.getElementById("settings-view");
const btnNavToSettings = document.getElementById("nav-to-settings");
const btnNavToMain = document.getElementById("nav-to-main");
const toast = document.getElementById("status-toast");

// --- REPOSITORY DETAILS ---
const REPO_OWNER = "Reshma-Thouti";
const REPO_NAME = "Leet_GFG_solutions";
const BRANCH = "main";
// --------------------------

// --- Tab Switching Logic ---
const tabBtns = document.querySelectorAll('.tab-btn');
const platformSections = document.querySelectorAll('.platform-section');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(t => t.classList.remove('active'));
        platformSections.forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.getAttribute('data-target')).classList.add('active');
    });
});

// Navigation Logic
btnNavToSettings.addEventListener("click", () => { viewMain.classList.remove("active"); viewSettings.classList.add("active"); });
btnNavToMain.addEventListener("click", () => { viewSettings.classList.remove("active"); viewMain.classList.add("active"); });

function showToast(text, isError = false) {
    toast.innerText = text;
    toast.className = isError ? "error show" : "success show";
    setTimeout(() => { toast.classList.remove("show"); }, 2500);
}

// --- Active Tab Detection ---
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const currentUrl = (tabs && tabs[0] && tabs[0].url) ? tabs[0].url : "";

    const lcBtn = document.getElementById("lc-sync-btn");
    const gfgBtn = document.getElementById("gfg-sync-btn");

    if (currentUrl.includes("leetcode.com/problems")) {
        lcBtn.classList.remove("disabled");
        document.getElementById("lc-hint-title").innerText = "LeetCode problem detected!";
        document.getElementById("lc-hint-sub").innerText = "Sync your current problem to continue tracking.";
        document.querySelector('[data-target="lc-section"]').click();
    } else if (currentUrl.includes("geeksforgeeks.org/problems") || currentUrl.includes("practice.geeksforgeeks.org")) {
        gfgBtn.classList.remove("disabled");
        document.getElementById("gfg-hint-title").innerText = "GFG problem detected!";
        document.getElementById("gfg-hint-sub").innerText = "Sync your current problem to continue tracking.";
        document.querySelector('[data-target="gfg-section"]').click();
    }
});

// --- Dynamic Chart Engine ---
function updateChart(platform, segments) {
    const total = segments.reduce((sum, seg) => sum + seg.count, 0);
    document.getElementById(`${platform}-total`).innerText = total;
    segments.forEach(seg => { const el = document.getElementById(`${platform}-${seg.id}`); if (el) el.innerText = seg.count; });

    if (total > 0) {
        const gapColor = "#0B1121"; // Matches --bg-main to create the invisible gap
        const gap = 1.5;
        const activeSegments = segments.filter(seg => seg.count > 0);

        if (activeSegments.length === 1) {
            document.getElementById(`${platform}-ring`).style.background = activeSegments[0].color;
            return;
        }

        let stops = [];
        let start = 0;
        activeSegments.forEach(seg => {
            let pct = (seg.count / total) * 100;
            let end = start + pct;
            stops.push(`${seg.color} ${start}% ${end - gap}%`);
            stops.push(`${gapColor} ${end - gap}% ${end}%`);
            start = end;
        });
        document.getElementById(`${platform}-ring`).style.background = `conic-gradient(${stops.join(', ')})`;
    }
}

// --- GitHub Tree Parsing ---
async function syncCountWithGitHub(token) {
    try {
        const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${BRANCH}?recursive=1`;
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

        if (response.ok) {
            const data = await response.json();
            let lc = { easy: 0, med: 0, hard: 0 };
            let gfg = { basic: 0, easy: 0, med: 0, hard: 0 };
            let totalSolved = 0;

            data.tree.forEach(item => {
                if (item.path.endsWith('README.md') && item.path.split('/').length > 3) {
                    totalSolved++;
                    if (item.path.startsWith('LeetCode/')) {
                        if (item.path.includes('/Easy/')) lc.easy++;
                        if (item.path.includes('/Medium/')) lc.med++;
                        if (item.path.includes('/Hard/')) lc.hard++;
                    }
                    else if (item.path.startsWith('GeeksforGeeks/')) {
                        if (item.path.includes('/Basic/') || item.path.includes('/School/')) gfg.basic++;
                        else if (item.path.includes('/Easy/')) gfg.easy++;
                        if (item.path.includes('/Medium/')) gfg.med++;
                        if (item.path.includes('/Hard/')) gfg.hard++;
                    }
                }
            });

            updateChart('lc', [
                { id: 'easy', count: lc.easy, color: '#10B981' },
                { id: 'med',  count: lc.med,  color: '#F97316' },
                { id: 'hard', count: lc.hard, color: '#EF4444' }
            ]);

            updateChart('gfg', [
                { id: 'basic', count: gfg.basic, color: '#3B82F6' },
                { id: 'easy',  count: gfg.easy,  color: '#10B981' },
                { id: 'med',   count: gfg.med,   color: '#F97316' },
                { id: 'hard',  count: gfg.hard,  color: '#EF4444' }
            ]);

            // Update the new Global Stats Box
            document.getElementById("global-total").innerText = totalSolved;
            chrome.storage.local.set({ syncCount: totalSolved });

            // 🚀 UPGRADED: DRAGON SETTINGS UI HOOKS
            document.getElementById("connection-status").className = "status-indicator online";
            const connText = document.getElementById("connection-text");
            connText.innerText = "Connected to GitHub";
            connText.className = "widget-status connected";
        }
    } catch (error) {
        document.getElementById("connection-status").className = "status-indicator offline";
        const connText = document.getElementById("connection-text");
        connText.innerText = "Connection Failed";
        connText.className = "widget-status failed";
    }
}

// --- Sync Triggers ---
const triggerSync = (btn) => {
    if (btn.classList.contains("disabled")) return;
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<span class="btn-text">Pushing...</span>`;
    btn.style.opacity = "0.8";

    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "FORCE_SYNC" }, (response) => {
            btn.innerHTML = originalContent;
            btn.style.opacity = "1";
            if (chrome.runtime.lastError) {
                showToast("Please refresh the page and try again.", true);
            } else {
                showToast("Successfully Pushed! 🚀");
            }
        });
    });
};

document.getElementById("lc-sync-btn").addEventListener("click", function() { triggerSync(this); });
document.getElementById("gfg-sync-btn").addEventListener("click", function() { triggerSync(this); });

// --- Save Token ---
document.getElementById("save").addEventListener("click", () => {
    const token = document.getElementById("token").value.trim();
    if (!token) { showToast("Please enter a valid token!", true); return; }

    chrome.storage.local.set({ githubToken: token }, () => {
        showToast("Token securely saved!");
        document.getElementById("token").value = "";
        document.getElementById("token").placeholder = "••••••••••••••••••••";
        syncCountWithGitHub(token);
        setTimeout(() => { viewSettings.classList.remove("active"); viewMain.classList.add("active"); }, 1000);
    });
});

// --- Relative Time Helper ---
function timeAgo(dateInput) {
    if (!dateInput) return "Just now";
    const seconds = Math.floor((new Date() - new Date(dateInput)) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

// --- Recent Syncs ---
function renderRecentSyncs(syncs) {
    const list = document.getElementById("recent-list");
    list.innerHTML = "";

    if (!syncs || syncs.length === 0) {
        list.innerHTML = '<li style="text-align: center; color: var(--text-muted); font-size: 12px; margin-top: 10px;">No recent syncs yet.</li>';
        return;
    }

    // Grab the time of the very first item to update the "Last Sync" box!
    if (syncs[0].timestamp) {
        document.getElementById("last-sync").innerText = timeAgo(syncs[0].timestamp);
    } else {
        document.getElementById("last-sync").innerText = "Just now";
    }

    // Only show top 4 to fit nicely above the banner
    syncs.slice(0, 4).forEach(sync => {
        const a = document.createElement("a");
        a.href = sync.url; a.target = "_blank"; a.className = "recent-item";

        let diffClass = "diff-med";
        const diffLower = sync.difficulty.toLowerCase();
        if (["easy", "basic", "school"].includes(diffLower)) diffClass = "diff-easy";
        if (diffLower === "hard") diffClass = "diff-hard";

        const platformColor = sync.platform === 'LeetCode' ? 'color: var(--brand-lc); border-color: rgba(249,115,22,0.3);' : 'color: var(--brand-gfg); border-color: rgba(16,185,129,0.3);';

        // Use our helper to format the time
        const timeDisplay = timeAgo(sync.timestamp);

        a.innerHTML = `
            <div class="diff-dot ${diffClass}"></div>
            <span class="item-title">${sync.title}</span>
            <span class="platform-badge" style="${platformColor}">${sync.platform === 'LeetCode' ? 'LeetCode' : 'GFG'}</span>
            <span class="time-badge">${timeDisplay}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--border-color); margin-left: 4px;"><polyline points="9 18 15 12 9 6"></polyline></svg>
        `;
        list.appendChild(a);
    });
}

// --- Init & Storage ---
chrome.storage.local.get(["githubToken", "syncCount", "recentSyncs", "currentStreak", "maxStreak"], (result) => {
    if (result.githubToken) {
        document.getElementById("token").placeholder = "••••••••••••••••••••";
        syncCountWithGitHub(result.githubToken);
    }

    // Total Solved
    if (result.syncCount !== undefined) {
        document.getElementById("global-total").innerText = result.syncCount;
    }

    // 🚀 STREAKS!
    if (result.currentStreak !== undefined) {
        document.getElementById("current-streak").innerText = result.currentStreak;
    }
    if (result.maxStreak !== undefined) {
        document.getElementById("max-streak").innerText = result.maxStreak;
    }

    renderRecentSyncs(result.recentSyncs || []);
});

// Live Updates for when you have the popup open and a sync finishes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.syncCount) document.getElementById("global-total").innerText = changes.syncCount.newValue;
        if (changes.currentStreak) document.getElementById("current-streak").innerText = changes.currentStreak.newValue;
        if (changes.maxStreak) document.getElementById("max-streak").innerText = changes.maxStreak.newValue;
        if (changes.recentSyncs) renderRecentSyncs(changes.recentSyncs.newValue);
    }
});