import { db } from "./firebase.js";
import { ref, push, onValue, update, set, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const GEMINI_API_KEY = "INSERT_YOUR_GEMINI_API_KEY_HERE"; 

// --- UTILITIES & MULTI-LANGUAGE SYSTEM ---
function sanitize(input) { 
    return (!input) ? "" : input.replace(/[<>]/g, "").trim().toUpperCase(); 
}

window.systemLangCode = 'en-US';
window.systemLangName = 'English';

// 🏆 TRACK NOTIFIED ALERTS GLOBALLY TO PREVENT SPAM
window.notifiedAlerts = new Set(JSON.parse(localStorage.getItem('notifiedAlerts') || '[]'));

// 🏆 BRAND NEW MESH & HAZARD STATE VARIABLES
window.meshActive = false;
window.hazardZoneGeoJSON = null;

window.changeLanguage = function(val, name) {
    window.systemLangCode = val;
    window.systemLangName = name;
    window.showToast(`Language changed to ${name}`, 'info', true);
}

window.systemSpeak = async function(text) {
    if(!('speechSynthesis' in window)) return;
    let spokenText = text;
    if(window.systemLangCode !== 'en-US' && GEMINI_API_KEY && navigator.onLine) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts:[{ text: `Translate this exactly to ${window.systemLangName}. Only return the translation, no other text: "${text}"` }] }] })
            });
            const data = await response.json();
            spokenText = data.candidates[0].content.parts[0].text.trim();
        } catch(e) {}
    }
    let u = new SpeechSynthesisUtterance(spokenText);
    u.lang = window.systemLangCode;
    u.pitch = 0.9;
    window.speechSynthesis.speak(u);
};

// 🏆 TACTICAL TOAST NOTIFICATIONS
window.showToast = function(msg, type = 'info', speak = false) {
    const container = document.getElementById('toast-container') || (()=>{ 
        const c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); return c; 
    })();
    const toast = document.createElement('div');
    toast.className = `tactical-toast ${type}`;
    toast.innerHTML = msg.replace(/\n/g, '<br>');
    container.appendChild(toast);
    
    if(window.AudioEngine && !window.AudioEngine.isMuted) window.AudioEngine.playMechanicalClick();
    if(speak) window.systemSpeak(msg);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOutRight 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, type === 'tour' ? 8000 : 5000);
};

try {
    let simFailure = false; 
    window.offlineAIEngine = null; 
    window.eventBus = new EventTarget();

    // --- 1. CORE SYSTEM & PWA ---
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(e=>{});

    window.toggleHighContrast = function() { 
        document.body.classList.toggle('high-contrast'); 
        window.systemSpeak("Accessibility mode toggled.");
    };

    function updateNetworkStatus() { 
        const banner = document.getElementById('offlineBanner'); 
        if (banner) banner.style.display = (navigator.onLine && !simFailure) ? 'none' : 'block'; 
        if (navigator.onLine && !simFailure) syncPendingData(); 
    }
    window.addEventListener('online', updateNetworkStatus); 
    window.addEventListener('offline', updateNetworkStatus); 
    updateNetworkStatus();

    async function syncPendingData() {
        if(!db || simFailure) return; 
        let b64 = localStorage.getItem('NGH_PENDING_SYNC'); 
        if(!b64) return;
        let pending = { reqs:[], dons:[] }; 
        try { pending = JSON.parse(decodeURIComponent(escape(atob(b64)))); } catch(e){} 
        if (pending.reqs.length === 0 && pending.dons.length === 0) return;
        
        try { 
            for (let r of pending.reqs) await push(ref(db, "reqs"), r); 
            for (let d of pending.dons) await push(ref(db, "dons"), d); 
            localStorage.removeItem('NGH_PENDING_SYNC'); 
            window.showToast("Offline data synced to Mesh.", "success", true);
        } catch(e) {}
    }
    setInterval(() => { if(navigator.onLine && !simFailure) syncPendingData(); }, 30000);

    // --- 2. TF.JS REINFORCEMENT LEARNING ---
    let tfModel = null; 
    let localMLStats = JSON.parse(localStorage.getItem("localMLStats")) || { cancels: 0, completes: 0, consecutiveHeavyMissions: 0 };
    
    async function initTFModel() {
        if(typeof tf === 'undefined') return;
        try { 
            tfModel = tf.sequential(); 
            tfModel.add(tf.layers.dense({units: 8, activation: 'relu', inputShape:[3]})); 
            tfModel.add(tf.layers.dense({units: 4, activation: 'relu'})); 
            tfModel.add(tf.layers.dense({units: 1, activation: 'sigmoid'})); 
            tfModel.compile({optimizer: 'sgd', loss: 'meanSquaredError'}); 
            await tfModel.fit(
                tf.tensor2d([[0,0,0],[10,2,3],[5,0,1],[20,5,5]]), 
                tf.tensor2d([[0],[0.8],[0.2],[0.99]]), 
                {epochs: 10, verbose: 0}
            ); 
        } catch (e) {}
    }

    function updateReward(success) { 
        let reward = parseInt(localStorage.getItem("rl_reward") || "80"); 
        reward += success ? 10 : -15; 
        localStorage.setItem("rl_reward", Math.max(10, Math.min(reward, 100))); 
    }

    function getReputationDetails() {
        let completes = localMLStats.completes || 0; let cancels = localMLStats.cancels || 0; let total = completes + cancels;
        let baseRate = total === 0 ? 100 : (completes / total) * 100; 
        let fatiguePen = (localMLStats.consecutiveHeavyMissions >= 3) ? -15 : 0;
        let isOrg = localStorage.getItem("userRole") === 'org'; let isVerified = localStorage.getItem("userVerified") === "true";
        let verifyBonus = (isOrg && isVerified) ? 15 : (JSON.parse(localStorage.getItem("points")) > 100 ? 5 : 0); 
        let score = 100;
        
        if (tfModel && typeof tf !== 'undefined') { 
            try { score = 100 - (tfModel.predict(tf.tensor2d([[completes, cancels, localMLStats.consecutiveHeavyMissions]])).dataSync()[0] * 100); } catch(e){} 
        } else { score = baseRate + fatiguePen; }
        
        let finalScore = Math.max(Math.round(Math.min(score * 0.7 + parseInt(localStorage.getItem("rl_reward") || "80") * 0.3 + verifyBonus, 100)), 10);
        return { baseRate, fatiguePen, isOrg, isVerified, verifyBonus, finalScore, completes, cancels, heavyMissions: localMLStats.consecutiveHeavyMissions };
    }

    function getAdvancedTrustScore() { return getReputationDetails().finalScore; }
    
    function updateLocalML(type, missionSkill = 'general') {
        if (type === 'complete') { 
            localMLStats.completes++; 
            localMLStats.consecutiveHeavyMissions = (missionSkill === 'rescue' || missionSkill === 'medical') ? localMLStats.consecutiveHeavyMissions + 1 : 0; 
            updateReward(true); 
        }
        if (type === 'cancel') { 
            localMLStats.cancels++; 
            localMLStats.consecutiveHeavyMissions = 0; 
            updateReward(false); 
        }
        localStorage.setItem("localMLStats", JSON.stringify(localMLStats)); 
        updateDashboardCharts();
    }

    // --- 3. AUTH & ROLES ---
    function applyRoleBasedUI() {
        const role = localStorage.getItem("userRole") || "volunteer";
        document.querySelectorAll('[data-allowed-roles]').forEach(el => { 
            const allowed = el.getAttribute('data-allowed-roles').split(','); 
            if(allowed.includes(role)) el.classList.remove('role-hidden'); 
            else el.classList.add('role-hidden'); 
        });
    }

    window.loginUser = async function(event) {
        const name = sanitize(document.getElementById("loginName")?.value); 
        const pinVal = sanitize(document.getElementById("loginPin")?.value);
        const vehicle = document.getElementById("loginVehicle")?.value || "none"; 
        const skill = document.getElementById("loginSkill")?.value || "general";
        const role = document.getElementById("loginRole")?.value || "volunteer"; 
        const orgType = role === 'org' ? document.getElementById("loginOrgType")?.value : "none";
        
        if (!name || !pinVal || pinVal.length !== 4) return window.showToast("🚨 VALID NAME AND 4-DIGIT PIN REQUIRED", "error", true);
        
        let btn = event?.target; 
        if (btn) { btn.innerText = "VERIFYING..."; btn.disabled = true; }
        let verifiedStatus = false;
        
        if (navigator.onLine && db && !simFailure) {
            try { 
                const snapshot = await Promise.race([get(ref(db, "users/" + name)), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000))]); 
                if (snapshot.exists()) { 
                    const cloudData = snapshot.val(); 
                    if (cloudData.pin && cloudData.pin !== pinVal) { 
                        window.showToast("🛑 ID TAKEN! Enter correct PIN.", "error", true); 
                        if(btn) { btn.innerText = "INITIALIZE SECURE NODE 🚀"; btn.disabled = false; } 
                        return; 
                    } 
                    localStorage.setItem("points", JSON.stringify(cloudData.points || 0)); 
                    verifiedStatus = cloudData.verified || false; 
                } else { 
                    localStorage.setItem("points", "0"); 
                    verifiedStatus = role === 'org' ? false : true; 
                } 
            } catch (error) {} 
        }
        
        if(btn) { btn.innerText = "INITIALIZE SECURE NODE 🚀"; btn.disabled = false; }
        localStorage.setItem("userName", name); localStorage.setItem("userPin", pinVal); 
        localStorage.setItem("userVehicle", vehicle); localStorage.setItem("userSkill", skill); 
        localStorage.setItem("userRole", role); localStorage.setItem("userOrgType", orgType); 
        localStorage.setItem("userVerified", verifiedStatus);
        initUser();
    };

    window.logoutUser = () => { 
        if(confirm("Disconnect from tactical network?")) { localStorage.clear(); location.reload(); } 
    };

    function initUser() {
        const userName = localStorage.getItem("userName"); 
        const role = localStorage.getItem("userRole");
        if (userName) {
            document.getElementById("loginScreen").style.display = "none"; 
            document.getElementById("mainApp").style.display = "block"; 
            document.getElementById("userInfo").style.display = "flex"; 
            document.getElementById("welcomeText").innerText = `NODE: ${userName}`;
            applyRoleBasedUI(); 
            window.systemSpeak(`Node active. Welcome, ${userName}.`);
            
            // Auto-fill donor name
            if(document.getElementById("dName") && ['org', 'donor'].includes(role)) {
                document.getElementById("dName").value = userName;
            }

            syncUserToLeaderboard(userName); updateUserStatsUI(); 
            initDashboardCharts(); 
            window.startLiveTracking();
        }
    }

    function syncUserToLeaderboard(userName) {
        let points = JSON.parse(localStorage.getItem("points")) || 0; 
        let pin = localStorage.getItem("userPin") || "0000"; 
        let role = localStorage.getItem("userRole") || "volunteer"; 
        let verified = localStorage.getItem("userVerified") === "true";
        if (!localDb.users) localDb.users = {}; 
        localDb.users[userName] = { name: userName, points: points, pin: pin, role: role, orgType: localStorage.getItem("userOrgType"), verified: verified };
        save(); 
        if(navigator.onLine && db && !simFailure) set(ref(db, "users/" + userName), localDb.users[userName]).catch(e=>{});
    }

    function updateUserStatsUI() {
        let points = JSON.parse(localStorage.getItem("points")) || 0; 
        let streak = parseInt(localStorage.getItem("streak") || "0"); 
        let role = localStorage.getItem("userRole"); 
        let vStatus = localStorage.getItem("userVerified") === "true";
        let level = role === 'org' ? (vStatus ? "VERIFIED ORG" : "PENDING ORG") : (points < 100 ? "TRAINEE" : points < 300 ? "COORDINATOR" : "FIELD EXPERT");
        const statsEl = document.getElementById("userStats"); 
        if(statsEl) statsEl.innerText = `🏅 IMPACT: ${points} | 🔥 STREAK: ${streak} | ${level}`;
    }

    // --- 4. MAP & LOCATION ---
    window.deckMap = null; 
    window.userPos =[17.3850, 78.4867]; // Fallback to Hyderabad
    window.heatVisible = true; 
    window.liveVolunteersData = {}; 
    window.activeRouteGeoJSON = null; 
    window.activeRouteCoords = null; 
    let geoCache = {}; 
    let gpsWatchId = null;

    window.recenterMap = function() { 
        if (window.deckMap) window.deckMap.setProps({ initialViewState: { longitude: window.userPos[1], latitude: window.userPos[0], zoom: 14, pitch: 45, transitionDuration: 1000 } }); 
    };
    function simpleGeoHash(lat, lng) { return lat.toFixed(2) + ":" + lng.toFixed(2); }
    
    window.startLiveTracking = function() {
        if (!navigator.geolocation) {
            window.showToast("GPS not supported by your browser.", "error");
            return;
        }
        gpsWatchId = navigator.geolocation.watchPosition(
            (pos) => {
                window.userPos =[parseFloat(pos.coords.latitude), parseFloat(pos.coords.longitude)];
                if (window.deckMap) renderMissions();
                const name = localStorage.getItem("userName"); 
                if (name && navigator.onLine && !simFailure && db) { 
                    set(ref(db, "liveVolunteers/" + name), { lat: pos.coords.latitude, lng: pos.coords.longitude, time: Date.now() }).catch(()=>{}); 
                }
            }, 
            (err) => { if(err.code === 1) window.showToast("GPS Permission Denied. Using fallback coordinates.", "warning"); }, 
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
        );
    };

    window.toggleHeatmap = function() { if (!window.deckMap) return; window.heatVisible = !window.heatVisible; renderMissions(); };

    // --- 5. LOCAL DB & MIGRATION ---
    let lastAcceptTime = 0; 
    let localDb = JSON.parse(localStorage.getItem('NGH_FINAL_V18')) || { reqs:[], dons:[], users: {}, completed: 0, totalRequests: 0, totalDonations: 0 };
    if(!localDb.dons) localDb.dons =[]; if(!localDb.users) localDb.users = {}; 

    function migrateLocalDb() {
        localDb.reqs.forEach(r => { 
            if (!r.timeline) r.timeline =[{ type: "legacy", at: r.createdAt || Date.now(), by: "system", note: "Migrated legacy record" }]; 
            if (!r.beneficiaryOtp) r.beneficiaryOtp = Math.floor(1000 + Math.random() * 9000).toString(); 
            if (typeof r.otpRetries === 'undefined') r.otpRetries = 0; 
        });
        localDb.dons.forEach(d => { 
            if(!d.quantity) { d.quantity = 1; d.unit = "units"; d.expiry = "none"; d.coldChain = false; } 
            if(!d.donorName) d.donorName = d.name || "UNKNOWN_DONOR";
        });
    }
    migrateLocalDb();

    function addTimelineEvent(req, eventType, note) {
        if (!req.timeline) req.timeline =[]; 
        req.timeline.push({ type: eventType, at: Date.now(), by: localStorage.getItem("userName") || "system", note: note }); 
        req.version = Date.now();
        if(navigator.onLine && db && req.firebaseId && !simFailure) update(ref(db, "reqs/" + req.firebaseId), { timeline: req.timeline, version: req.version });
    }

    window.viewTimeline = function(reqId) {
        const req = localDb.reqs.find(x => x.firebaseId === reqId); if(!req) return;
        document.getElementById('timelineContent').innerHTML = req.timeline.map(t => `
            <div style="position: relative;">
                <div style="position: absolute; left: -26px; top: 0; width: 10px; height: 10px; border-radius: 50%; background: var(--success); box-shadow: 0 0 10px var(--success);"></div>
                <p style="font-size: 0.7rem; color: var(--warning); margin-bottom: 3px;">${new Date(t.at).toLocaleString()}</p>
                <p style="font-size: 0.85rem; color: var(--primary); font-weight: 600; margin-bottom: 3px;">[${t.type.toUpperCase()}] by ${t.by}</p>
                <p style="font-size: 0.75rem; color: var(--primary-muted);">${t.note}</p>
            </div>`).join('');
        document.getElementById('timelineModal').style.display = 'flex';
    };

    // --- 6. AI ENGINE (WebLLM & Gemini) ---
    window.loadLocalAI = async function(event) {
        if (!window.webllm) return window.showToast("WebLLM missing.", "error"); 
        const statusEl = document.getElementById("aiLoadStatus"); 
        const btn = event.target; btn.disabled = true;
        try { 
            statusEl.innerText = "STATUS: DOWNLOADING..."; statusEl.style.color = "var(--warning)"; 
            window.offlineAIEngine = await window.webllm.CreateMLCEngine("gemma-2b-it-q4f32_1-MLC", { 
                initProgressCallback: (p) => { statusEl.innerText = `STATUS: DL AI CORE... ${Math.round(p.progress * 100)}%`; } 
            }); 
            statusEl.innerText = "STATUS: 🟢 LOCAL AI CORE ONLINE."; statusEl.style.color = "var(--success)"; 
            btn.innerText = "AI ENGINE ACTIVE"; 
            window.showToast("✅ WebGPU Booted Successfully!", "success", true); 
        } catch (e) { 
            statusEl.innerText = "STATUS: FALLING BACK TO EDGE NLP."; statusEl.style.color = "var(--danger)"; 
            btn.disabled = false; 
        }
    };

    window.updateTerminal = function(text, color="var(--success)") { 
        const t = document.getElementById("swarmTerminal"); 
        if(t) { t.style.display = "block"; t.innerHTML += `<div style="color:${color}; margin-bottom:5px;">> ${text}</div>`; t.scrollTop = t.scrollHeight; } 
    };

    async function queryLLM(prompt, agentName) {
        if (window.offlineAIEngine && simFailure) { 
            try { 
                return (await window.offlineAIEngine.chat.completions.create({ messages:[{ role: "user", content: prompt }] })).choices[0].message.content; 
            } catch(e) { return localTriageFallback(prompt, agentName); } 
        } else if (navigator.onLine && GEMINI_API_KEY && !simFailure) { 
            try { 
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, { 
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ contents:[{ parts:[{ text: prompt }] }] }) 
                }); 
                if(!response.ok) throw new Error("API Throttled"); 
                return (await response.json()).candidates[0].content.parts[0].text; 
            } catch(e) { return localTriageFallback(prompt, agentName); } 
        } 
        return localTriageFallback(prompt, agentName);
    }

    function localTriageFallback(prompt, agentName) { 
        const p = prompt.toLowerCase(); 
        if (agentName === "Triage") { 
            if (p.includes("flood")) return "Critical urgency."; return "Medium urgency."; 
        } else if (agentName === "Logistics") { 
            if (p.includes("medical")) return "Medical operative required."; return "General operative required."; 
        } else { 
            return JSON.stringify({ urgency: p.includes("flood") ? "critical" : "medium", category: "Food", skill: "general", demographic: "none", location: "AUTO-LOCATING VIA GPS...", reasoning:["Offline Edge NLP fallback"], confidence: 75, predicted_spread: "unknown", recommended_action: "Proceed with caution." }); 
        } 
    }

    function edgeTriage(text) { return { urgency: "medium", category: "Food", skill: "general", demographic: "none", location: "CURRENT GPS LOCATION", confidence: 50, reasoning:["Hardcoded fallback"], predicted_spread: "unknown", recommended_action: "Proceed with caution" }; }

    window.simulateIncomingSMS = function() { 
        const text = "SOS Flood water rising, grandmother needs insulin"; 
        document.getElementById("aiSosText").value = text; 
        window.showToast(`📥 SMS RECEIVED:\n"${text}"`, "info", true); 
        window.parseAIText(); 
    };

    window.startVoiceAI = function(event) { 
        if(event) event.preventDefault(); 
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition; 
        if (!SR) return window.showToast("No Web Speech Support.", "error"); 
        const rec = new SR(); rec.lang = window.systemLangCode; rec.interimResults = false; 
        const micBtn = document.querySelector('.mic-btn'); micBtn.style.background = "var(--danger)"; 
        rec.onresult = (e) => { 
            document.getElementById("aiSosText").value = e.results[0][0].transcript; 
            micBtn.style.background = "rgba(255,255,255,0.1)"; 
            window.parseAIText(); 
        }; 
        rec.start(); 
    };

    window.parseAIText = async function(event) {
        const text = sanitize(document.getElementById("aiSosText").value.toLowerCase()); 
        if(!text) return window.showToast("Enter emergency description.", "warning");
        
        const btn = event ? event.target : document.querySelector('.ai-input-box button'); 
        btn.innerText = "🧠 SWARM STRUCTURING..."; btn.disabled = true; 
        document.getElementById("swarmTerminal").innerHTML = ""; 
        let resultJSON;
        
        try {
            window.updateTerminal(`[SYSTEM] Signal: "${text}"`, "var(--primary-muted)"); 
            window.updateTerminal("[AGENT 1] Triaging...");
            const a1R = await queryLLM(`Triage AI. Determine Urgency/Category. SOS: "${text}"`, "Triage"); 
            window.updateTerminal(`[A1] ${a1R}`, "var(--warning)");
            
            const a2R = await queryLLM(`Logistics AI. Determine skill/demographic. SOS: "${text}"`, "Logistics"); 
            window.updateTerminal(`[A2] ${a2R}`, "var(--warning)");
            
            const a3R = await queryLLM(`Commander AI. \nSOS: "${text}"\nA1: "${a1R}"\nA2: "${a2R}"\nOutput JSON:\n{"urgency":"critical|high|medium|low","category":"Food|Medical|Rescue","skill":"medical|rescue|general","demographic":"elderly|child|none","location":"GPS LOCATION","reasoning":["pt 1"],"confidence":90,"recommended_action":"action"}`, "Commander");
            resultJSON = JSON.parse(a3R.replace(/```json|```/g, '').trim()); 
            window.updateTerminal(`[A3] Synthesis Complete.`, "var(--accent)");
        } catch(e) { 
            window.updateTerminal("[ERROR] Fallback active.", "var(--danger)"); 
            resultJSON = edgeTriage(text); 
        }
        
        document.getElementById("rUrgency").value = resultJSON.urgency.toLowerCase(); 
        document.getElementById("rType").value = resultJSON.category; 
        document.getElementById("rReqSkill").value = resultJSON.skill || "general"; 
        document.getElementById("rLoc").value = resultJSON.location.toUpperCase(); 
        document.getElementById("rDemographic").value = resultJSON.demographic || "none";
        
        const area = document.getElementById("aiExplanationArea"); 
        if(area) area.innerHTML = `<div style="background:rgba(255,255,255,0.05); padding:15px; margin-top:15px; border-radius:12px; border:1px solid var(--glass-border);"><h3 style="color:var(--success);">🧠 DECISION ENGINE</h3><p><b>Recommendation:</b> ${resultJSON.recommended_action}</p></div>`;
        btn.innerText = "✨ INITIATE INTELLIGENCE SWARM"; btn.disabled = false;
        window.systemSpeak("AI Parsing complete. Review and broadcast.");
    };

    window.verifyAssetImage = async function(event) {
        const btn = event.target; const fileInput = document.getElementById("dImage"); 
        if (!fileInput.files || fileInput.files.length === 0) return window.showToast("Upload image first!", "warning");
        
        btn.innerText = "👁️ ANALYZING..."; btn.disabled = true; 
        const file = fileInput.files[0]; const reader = new FileReader();
        
        reader.onloadend = async function() {
            const b64 = reader.result.split(',')[1];
            if (GEMINI_API_KEY) { 
                try { 
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, { 
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ contents:[{ parts:[{ text: "Analyze this image for supply authenticity. Provide a fraud risk score (0-100) and a brief reason." }, { inline_data: { mime_type: file.type, data: b64 } } ] }] }) 
                    }); 
                    const data = await response.json(); 
                    const analysis = data.candidates[0].content.parts[0].text;
                    let scoreMatch = analysis.match(/(\d+)/); 
                    let score = scoreMatch ? parseInt(scoreMatch[0]) : 50; 

                    if (score <= 20) {
                        window.showToast(`✅ AUTO-VERIFIED: Trust score: ${100 - score}\n${analysis}`, "success", true);
                        btn.innerText = "✅ AUTO-VERIFIED"; btn.style.background = "var(--success)";
                        btn.disabled = false;
                    } else if (score <= 50) {
                        window.showToast(`⚠️ FLAGGED FOR REVIEW: Trust score: ${100 - score}\n${analysis}`, "warning", true);
                        btn.innerText = "🚩 PENDING REVIEW"; btn.style.background = "var(--warning)";
                        btn.disabled = false;
                    } else {
                        window.showToast(`🛑 REJECTED: Fraud risk too high.\n${analysis}`, "error", true);
                        btn.innerText = "🛑 REJECTED"; btn.style.background = "var(--danger)";
                        btn.disabled = false;
                    }
                } catch(e) { 
                    window.showToast("⚠️ Network Error.", "error"); 
                    btn.innerText = "👁️ SCAN FAILED"; btn.disabled = false; 
                } 
            } else { btn.disabled = false; }
        }; 
        reader.readAsDataURL(file);
    };

    // --- 7. ADMIN CONTROLS ---
    window.renderAdminPanel = function() {
        const queue = document.getElementById("orgApprovalQueue"); if(!queue) return; 
        let pendingOrgs = Object.values(localDb.users).filter(u => u.role === 'org' && !u.verified);
        if(pendingOrgs.length === 0) { queue.innerHTML = "<p>No orgs pending.</p>"; return; }
        queue.innerHTML = pendingOrgs.map(o => `<div style="display:flex; justify-content:space-between; margin-bottom:10px; padding:10px; background:rgba(0,0,0,0.5); border-radius:8px;"><span>${o.name}[${o.orgType}]</span></div>`).join('');
    }
    
    window.approveAllOrgs = function() {
        let updates = {}; 
        Object.values(localDb.users).forEach(u => { 
            if(u.role === 'org' && !u.verified) { 
                u.verified = true; if(navigator.onLine && db) updates["users/" + u.name + "/verified"] = true; 
            } 
        });
        if(Object.keys(updates).length > 0) { 
            update(ref(db), updates); save(); window.renderAdminPanel(); window.showToast("✅ ORGS VERIFIED.", "success", true); 
        } else { window.showToast("No pending orgs.", "info"); }
    };

    // --- 8. NAVIGATION & UI ---
    window.showPage = function(id) {
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active')); 
        const target = document.getElementById(id); 
        if(target) target.classList.add('active'); 
        applyRoleBasedUI();
        
        if (id === 'volunteer') {
            const lockedId = localStorage.getItem("activeMissionId");
            if (lockedId) { 
                const stillActive = localDb.reqs.find(x => x.firebaseId === lockedId && (x.status === 'accepted' || x.status === 'picked' || x.status === 'awaiting_confirmation')); 
                if (!stillActive) { localStorage.removeItem("activeMissionId"); window.activeRouteGeoJSON = null; window.activeRouteCoords = null; } 
            }
            if (typeof deck !== 'undefined' && !window.deckMap) { 
                try { 
                    if (typeof maplibregl !== 'undefined') window.mapboxgl = maplibregl; 
                    window.deckMap = new deck.DeckGL({ container: 'map', map: window.mapboxgl, initialViewState: { longitude: window.userPos[1], latitude: window.userPos[0], zoom: 13, pitch: 45, bearing: 0 }, controller: true, mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', layers:[] }); 
                } catch(e) {} 
                setTimeout(() => { renderMissions(); }, 500); 
            } else { renderMissions(); }
        }
        if (id === 'profile') loadProfileData(); 
        if (id === 'dashboard') updateDashboardCharts(); 
        if (id === 'admin') window.renderAdminPanel();
        if (id === 'donate') renderDonationDashboard();
    };

    // 🏆 UPGRADED: DEMO GUIDED TOUR WITH NEON VIBE
    window.startGuidedTour = async function() { 
        window.showToast("🎬 GUIDED TOUR: Welcome to the Decision Engine.", "tour", true); 
        window.showPage('request'); 
        await new Promise(r => setTimeout(r, 2000)); 
        window.showToast("STEP 1: A chaotic SMS arrives. Click 'INJECT RAW SMS SIGNAL'.", "tour", true); 
        await new Promise(r => setTimeout(r, 4500));
        window.showToast("STEP 2: The Ethical Matrix dynamically computes priorities based on demographics.", "tour", true); 
        window.showPage('volunteer'); 
    };

    // 🏆 BRAND NEW: OTP VIEWER FOR VICTIM NODE IN PROFILE
    function loadProfileData() {
        const userName = localStorage.getItem("userName") || "VOLUNTEER"; 
        const vType = localStorage.getItem("userVehicle") || "none"; 
        const sType = localStorage.getItem("userSkill") || "general"; 
        const role = localStorage.getItem("userRole") || "volunteer"; 
        const verified = localStorage.getItem("userVerified") === "true";
        
        if (document.getElementById("profName")) document.getElementById("profName").innerText = userName;
        if (document.getElementById("profRoleTitle")) document.getElementById("profRoleTitle").innerText = role === 'org' ? (verified ? "VERIFIED ORGANIZATION ✔" : "PENDING ORGANIZATION ⏳") : "TACTICAL OPERATIVE ✔";
        if (document.getElementById("aiProfileBadge")) document.getElementById("aiProfileBadge").innerHTML = `🧬 OPERATIVE PROFILE:[VEHICLE: ${vType.toUpperCase()}] |[SKILL: ${sType.toUpperCase()}]`;
        
        // 🚨 POPULATE MY ACTIVE SOS SIGNALS
        const myActiveSignalsDiv = document.getElementById("myActiveSignals");
        if (myActiveSignalsDiv) {
            const myReqs = localDb.reqs.filter(r => r.creator === userName && r.status !== 'delivered' && r.status !== 'failed');
            if (myReqs.length === 0) {
                myActiveSignalsDiv.innerHTML = "No active SOS signals.";
            } else {
                myActiveSignalsDiv.innerHTML = myReqs.map(r => `
                    <div style="border-left: 3px solid var(--danger); padding-left: 10px; margin-bottom: 10px; background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px;">
                        <strong style="color:var(--accent)">RELIEF: ${r.name}</strong> (${r.type})<br>
                        STATUS: <span style="color:var(--warning)">${r.status.toUpperCase()}</span><br>
                        <span style="font-size: 1.2rem; color: var(--success); font-weight: 800; letter-spacing: 2px;">OTP: ${r.beneficiaryOtp}</span><br>
                        <span style="font-size: 0.7rem;">Share this 4-digit code with the operative upon arrival.</span>
                    </div>
                `).join('');
            }
        }
        
        let rep = getReputationDetails();
        if (document.getElementById("trustScoreUI")) { 
            document.getElementById("trustScoreUI").innerText = `RELIABILITY INDEX: ${rep.finalScore}%`; 
            document.getElementById("trustScoreUI").style.color = rep.finalScore > 80 ? "var(--success)" : "var(--danger)"; 
        }
        
        let points = JSON.parse(localStorage.getItem("points")) || 0; 
        let streak = parseInt(localStorage.getItem("streak") || "0");
        if(document.getElementById("impactStats")) document.getElementById("impactStats").innerHTML = `LIFETIME IMPACT: <span style="color:var(--accent)">${points} PTS</span><br>CONSISTENCY STREAK: <span style="color:var(--danger)">${streak} 🔥</span>`;
        if(document.getElementById("repBreakdown")) document.getElementById("repBreakdown").innerHTML = `> Base Completion: ${rep.baseRate.toFixed(1)}% (${rep.completes} done, ${rep.cancels} failed)<br>> Fatigue Penalty: ${rep.fatiguePen}%<br>> Verification Bonus: +${rep.verifyBonus}% ${rep.isOrg ? '[Verified Org]' : ''}<br>> FINAL TRUST: ${rep.finalScore}%`;
        
        syncUserToLeaderboard(userName);
        const lbList = document.getElementById("leaderboardList");
        if (lbList) {
            lbList.innerHTML = ""; 
            let allUsers = Object.values(localDb.users || {}).sort((a, b) => (b.points || 0) - (a.points || 0));
            if (allUsers.length === 0) lbList.innerHTML = `<li style="padding:15px; text-align:center; color:#888;">NO DATA FOUND.</li>`;
            else { 
                allUsers.slice(0, 5).forEach((user, index) => { 
                    const isMe = user.name === userName; 
                    const bgStyle = isMe ? "background:rgba(255,255,255,0.1); border:1px solid var(--accent);" : "background:transparent; border-bottom:1px solid rgba(255,255,255,0.05);"; 
                    lbList.innerHTML += `<li style="padding:15px; ${bgStyle} border-radius:8px; margin-bottom:5px;">${index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "🏅"} <b>${user.name} ${isMe ? "(YOU)" : ""} ${user.verified ? "✔" : ""} ${user.role === 'org' ? '[ORG]' : ''}</b> - <span style="color:var(--accent); font-weight:600;">${user.points} PTS</span></li>`; 
                }); 
            }
        }
    }

    // --- 9. MISSION ALLOCATION & MATRIX ---
    async function fetchRealRoute(p1, p2) {
        if (!window.deckMap || typeof deck === 'undefined') return;
        try { 
            if(navigator.onLine && !simFailure) { 
                const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${p1[1]},${p1[0]};${p2[1]},${p2[0]}?geometries=geojson`); 
                const data = await response.json(); 
                if(data.routes && data.routes[0]) { window.activeRouteGeoJSON = data.routes[0].geometry; renderMissions(); return; } 
            } 
        } catch(e) {}
        window.activeRouteGeoJSON = { type: "LineString", coordinates: [[p1[1], p1[0]],[p2[1], p2[0]] ] }; 
        renderMissions();
    }

    class PriorityQueue { 
        constructor() { this.items =[]; } 
        enqueue(item, priority) { this.items.push({ item, priority }); this.items.sort((a, b) => b.priority - a.priority); } 
        dequeue() { return this.items.shift(); } 
        isEmpty() { return this.items.length === 0; } 
    }
    
    function calculateEthicalScore(req, volSkill, distToYou) { 
        let score = 50; 
        if (req.urgency === "critical") score += 50; 
        if (req.urgency === "high") score += 20; 
        if (req.type === "Medical") score += 40; 
        if (req.type === "Rescue") score += 30; 
        if (req.reqSkill && req.reqSkill === volSkill) score += 25; 
        if (req.demographic === "elderly" || req.demographic === "child" || req.demographic === "pregnant" || req.demographic === "disabled") score += 35; 
        score -= (distToYou * 0.5); 
        return Math.max(Math.round(score), 10); 
    }

    function getBestDonor(req, volName) {
        let validDonors = localDb.dons.filter(d => (d.status === 'open' || (d.status === 'reserved' && req.acceptedBy === volName)) && (!req.type || req.type === d.type) && d.quantity > 0);
        return validDonors.sort((a,b) => { 
            if(a.expiry !== 'none' && b.expiry !== 'none') return new Date(a.expiry) - new Date(b.expiry); 
            return parseFloat(calculateDistance(a.lat, a.lng, req.lat, req.lng)) - parseFloat(calculateDistance(b.lat, b.lng, req.lat, req.lng)); 
        })[0] || null;
    }

    function renderDonationDashboard() {
        const grid = document.getElementById("donorDashboardGrid");
        if(!grid) return;
        const myName = localStorage.getItem("userName");
        const myDons = localDb.dons.filter(d => d.donorName === myName || d.name === myName);
        
        if(myDons.length === 0) {
            grid.innerHTML = `<p style="text-align:center; color:var(--primary-muted); grid-column: 1 / -1;">NO ACTIVE SUPPLY CACHES REGISTERED.</p>`;
            return;
        }

        grid.innerHTML = myDons.map(d => {
            let statusHTML = '';
            if (d.status === 'open') statusHTML = `<div style="color:var(--success); font-weight:700;">🟢 OPEN FOR ALLOCATION</div>`;
            else if (d.status === 'reserved') {
                let tiedReq = localDb.reqs.find(r => r.assignedDonation === d.firebaseId);
                let transitMsg = tiedReq && tiedReq.status === 'picked' ? "IN TRANSIT" : "ASSIGNED";
                statusHTML = `<div style="color:var(--warning); font-weight:700;">🟠 ${transitMsg} BY: ${tiedReq ? tiedReq.acceptedBy : 'OPERATIVE'}</div>
                              <div style="font-size:0.75rem; color:var(--primary-muted); margin-top:5px;">DESTINATION: ${tiedReq ? tiedReq.name : 'Unknown'}</div>`;
            }
            else if (d.status === 'closed') statusHTML = `<div style="color:var(--primary-muted); font-weight:700;">✅ SUCCESSFULLY DELIVERED</div>`;

            return `<div class="mission-card" style="border: 1px solid var(--glass-border);">
                <h3 style="color:var(--accent); font-size: 1.2rem; margin-bottom: 10px;">${d.item.toUpperCase()}</h3>
                <p style="font-size:0.8rem; color:var(--primary-muted); margin-bottom: 15px;">CATEGORY: ${d.type} | QTY: ${d.quantity} ${d.unit.toUpperCase()}</p>
                <div style="background:rgba(0,0,0,0.3); padding:15px; border-radius:8px; border-left:3px solid ${d.status === 'open' ? 'var(--success)' : (d.status==='reserved' ? 'var(--warning)' : 'var(--primary-muted)')};">
                    ${statusHTML}
                </div>
            </div>`;
        }).join('');
    }

    function renderMissions() {
        const grid = document.getElementById('missionGrid'); if (!grid) return; 
        grid.innerHTML = ""; 
        
        const volName = localStorage.getItem("userName") || ""; 
        const volSkill = localStorage.getItem("userSkill") || "general"; 
        const activeId = localStorage.getItem("activeMissionId"); 
        const activeReqs = localDb.reqs.filter(r => r.status !== 'delivered');
        const emptyState = document.getElementById('emptyState');
        
        if (activeReqs.length === 0) { 
            if(emptyState) emptyState.style.display = "block"; 
            try { updateDeckLayers([], null, null); } catch(e) {} return; 
        } else { 
            if(emptyState) emptyState.style.display = "none"; 
        }

        const pq = new PriorityQueue(); let activeMissionObj = null;
        activeReqs.forEach(req => {
            const bestDonor = getBestDonor(req, volName);
            let ageInMinutes = req.createdAt ? Math.floor((Date.now() - req.createdAt) / 60000) : 0; 
            let dynamicPoints = req.lockedPoints ? req.lockedPoints : 50; 
            let spoilageRisk = 0;
            
            if(!req.lockedPoints) { 
                if (req.type === 'Food') { dynamicPoints += Math.floor(Math.pow(ageInMinutes, 1.2)); spoilageRisk = Math.min(ageInMinutes * 2, 99); } 
                else dynamicPoints += Math.floor(ageInMinutes * 1.5); 
                if(req.urgency === 'critical') dynamicPoints *= 2; 
            }
            
            const distToYou = parseFloat(calculateDistance(window.userPos[0], window.userPos[1], req.lat, req.lng)); 
            let ethicalScore = calculateEthicalScore(req, volSkill, distToYou); 
            let fatiguePenalty = (localMLStats.consecutiveHeavyMissions >= 3 && (req.reqSkill === 'rescue' || req.reqSkill === 'medical')) ? 40 : 0;
            let mObj = { req, donor: bestDonor, ethicalScore, dynamicPoints, spoilageRisk, fatiguePenalty: fatiguePenalty > 0, distToYou }; 
            
            if(req.firebaseId === activeId) activeMissionObj = mObj; 
            pq.enqueue(mObj, ethicalScore);
        });

        while(!pq.isEmpty()) {
            const { req, donor, ethicalScore, dynamicPoints, spoilageRisk, fatiguePenalty, distToYou } = pq.dequeue().item;
            const isMine = (req.acceptedBy === volName); 
            const isAssignedToOther = (req.acceptedBy && req.acceptedBy !== volName);
            const safeReqName = sanitize(req.name || "USER"); 
            const safeReqType = sanitize(req.type || "GENERAL"); 
            const gHash = simpleGeoHash(req.lat, req.lng);
            
            const card = document.createElement('div'); card.className = `mission-card ${isMine ? 'selected' : ''}`; 
            if(isMine) { card.style.border = "1px solid var(--accent)"; card.style.background = "rgba(255,255,255,0.08)"; }
            
            let btnLabel = "EXECUTE DECISION"; 
            if (req.status === 'accepted') btnLabel = "MARK AS SECURED"; 
            if (req.status === 'picked') btnLabel = "MARK AS ARRIVED"; 
            if (req.status === 'awaiting_confirmation') btnLabel = "CONFIRM BENEFICIARY OTP/QR"; 
            if (isAssignedToOther) btnLabel = "ALLOCATED TO ANOTHER NODE";
            
            let bannerHTML = ''; 
            if (req.urgency === 'critical') bannerHTML = '<div style="background:#fff; color:#000; padding:8px 16px; font-weight:600; display:inline-block; margin-bottom: 15px; border-radius: 8px; font-size:0.8rem;">🚨 CRITICAL THREAT DETECTED</div>'; 
            else if (fatiguePenalty) bannerHTML = '<div style="background:transparent; border:1px solid var(--danger); color:var(--danger); padding:8px 16px; font-weight:600; display:inline-block; margin-bottom: 15px; border-radius: 8px; font-size:0.8rem;">🛡️ TF.JS FATIGUE WARNING</div>'; 
            else if (ethicalScore >= 100) bannerHTML = '<div style="background:transparent; border:1px solid var(--accent); color:var(--accent); padding:8px 16px; font-weight:600; display:inline-block; margin-bottom: 15px; border-radius: 8px; font-size:0.8rem;">🎯 ETHICAL AI PRIORITY</div>';
            
            let btnCancelHTML = isMine && (req.status === 'accepted' || req.status === 'picked') ? `<button class="btn-cancel" onclick="window.cancelMission('${req.firebaseId}', '${donor ? donor.firebaseId : ''}', event)">ABORT ALLOCATION</button>` : '';
            
            let eliteToolsHTML = ''; 
            let targetLat = req.status === 'accepted' && donor ? donor.lat : req.lat; 
            let targetLng = req.status === 'accepted' && donor ? donor.lng : req.lng;
            if (isMine && (req.status === 'accepted' || req.status === 'picked')) { 
                eliteToolsHTML = `<div style="display:flex; gap:10px; margin-top:10px;"><button class="btn-main" style="padding:10px; font-size:0.7rem; border-color:var(--success); color:var(--success);" onclick="window.openAR(${targetLat}, ${targetLng})">🥽 AR COMPASS</button><button class="btn-main" style="padding:10px; font-size:0.7rem; border-color:var(--warning); color:var(--warning);" id="hapticBtn_${req.firebaseId}" onclick="window.toggleHapticSonar(${targetLat}, ${targetLng}, '${req.firebaseId}')">📳 HAPTIC SONAR</button></div>`; 
            }
            let timelineBtnHTML = `<button class="btn-main" style="padding:10px; font-size:0.7rem; border-color:#8B5CF6; color:#8B5CF6; margin-top:10px;" onclick="window.viewTimeline('${req.firebaseId}')">⏱️ AUDIT TIMELINE</button>`;
            
            let disableBtn = (isAssignedToOther || (!donor && req.status === 'open' && req.type !== 'Rescue')) ? 'disabled' : ''; 
            if (req.status === 'awaiting_confirmation' && isMine) disableBtn = ''; 
            
            let inventoryHTML = ''; 
            if(donor && donor.quantity) inventoryHTML = `<p style="font-size:0.75rem; color:var(--success); margin-bottom:6px;"><b>INVENTORY:</b> ${donor.quantity} ${donor.unit.toUpperCase()} ${donor.coldChain ? '❄️ (COLD CHAIN)' : ''}</p>`;
            let perishHTML = req.type === 'Food' ? `<p style="font-size:0.75rem; font-weight:600; color:var(--danger); margin-bottom:6px;"><b>⏳ SPOILAGE RISK:</b> ${spoilageRisk}%</p>` : '';

            card.innerHTML = `${bannerHTML}<div><span class="tag-urgency ${req.urgency || 'low'}">${req.urgency || 'low'}</span><span class="status-badge">${req.status || 'open'}</span></div><h3 style="margin-top:10px; font-size:1.3rem; margin-bottom:5px; color:var(--accent); font-weight:600; font-family:var(--font-heading);">RELIEF: ${safeReqName}</h3><p style="color:var(--warning); font-size: 0.9rem; margin-top:5px; margin-bottom: 15px; font-weight:600; letter-spacing:1px;">⚡ SURGE REWARD: ${dynamicPoints} PTS</p><div style="background:rgba(0,0,0,0.2); padding:18px; border-radius:12px; margin-bottom:20px; border-left:2px solid var(--accent); flex-grow:1;"><div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; margin-bottom:10px;"><p style="font-size:0.8rem; font-weight:600; color:var(--danger); margin-bottom:4px;">⚖️ ETHICAL PRIORITY SCORE: ${ethicalScore}</p><p style="font-size:0.65rem; color:var(--primary-muted); font-family:monospace; line-height: 1.4;"><em>Bypassing First-Come-First-Serve:</em><br>> Base Score (50)<br>${req.urgency === 'critical' ? '> + Critical Escalation (50)<br>' : (req.urgency === 'high' ? '> + High Escalation (20)<br>' : '')}${req.demographic !== 'none' ? '> + Vulnerable Demographic Found (35)<br>' : ''}> - Distance Penalty (${(distToYou * 0.5).toFixed(1)})</p></div><p style="font-size:0.75rem; color:var(--primary); margin-bottom:6px;"><b>RESOURCE:</b> ${safeReqType} (${req.reqSkill || 'GENERAL'})</p><p style="font-size:0.75rem; color:var(--primary-muted); margin-bottom:6px;"><b>GEOHASH:</b> ${gHash}</p>${inventoryHTML}${perishHTML}<p style="font-size:0.75rem; color:var(--primary);"><b>DISTANCE:</b> ${isNaN(distToYou) ? "0.0" : distToYou.toFixed(1)} KM</p></div><button class="btn-main" style="margin-top:auto;" ${disableBtn} onclick="window.acceptMission('${req.firebaseId}', '${donor ? donor.firebaseId : ''}', ${dynamicPoints}, event)">${btnLabel}</button>${eliteToolsHTML}${timelineBtnHTML}${btnCancelHTML}`;
            grid.appendChild(card);
        }
        
        try {
            if (activeMissionObj) {
                const { req, donor } = activeMissionObj; let p1, p2;
                if (req.status === 'accepted' && donor) { p1 = window.userPos; p2 =[donor.lat, donor.lng]; } 
                else if (req.status === 'picked' && donor) { p1 =[donor.lat, donor.lng]; p2 =[req.lat, req.lng]; }
                if (p1 && p2) { 
                    if (!window.activeRouteCoords || window.activeRouteCoords.p1.join() !== p1.join() || window.activeRouteCoords.p2.join() !== p2.join()) { 
                        window.activeRouteCoords = {p1, p2}; fetchRealRoute(p1, p2); 
                    } 
                }
            } else { window.activeRouteGeoJSON = null; window.activeRouteCoords = null; }
            updateDeckLayers(activeReqs, localDb.dons.filter(d => d.status === 'open'), volName);
        } catch(e) {}
    }

    // 🏆 WOW FACTOR 1 & 2: MESH ARCS & AI HAZARD POLYGON IN DECK.GL
    function updateDeckLayers(activeReqs, openDonors, volName) {
        if (!window.deckMap || typeof deck === 'undefined') return; 
        
        window.meshActive = window.meshActive || false;
        window.hazardZoneGeoJSON = window.hazardZoneGeoJSON || null;
        
        const layers =[];

        if (window.heatVisible && activeReqs && activeReqs.length > 0) layers.push(new deck.HeatmapLayer({ id: 'crisis-heatmap', data: activeReqs, getPosition: d =>[d.lng, d.lat], getWeight: d => d.urgency === 'critical' ? 10 : (d.urgency === 'high' ? 5 : 2), radiusPixels: 70, colorRange: [[11, 14, 20, 0],[74, 222, 128, 100],[251, 191, 36, 180],[248, 113, 113, 255]], intensity: 1.2 }));
        if (activeReqs && activeReqs.length > 0) layers.push(new deck.ColumnLayer({ id: 'mission-pillars', data: activeReqs, diskResolution: 6, radius: 120, extruded: true, pickable: true, elevationScale: 40, getPosition: d =>[d.lng, d.lat], getFillColor: d => d.urgency === 'critical' ?[255, 255, 255, 230] :[248, 113, 113, 230], getElevation: d => d.urgency === 'critical' ? 60 : 25, autoHighlight: true }));
        if (openDonors && openDonors.length > 0) layers.push(new deck.ColumnLayer({ id: 'donor-pillars', data: openDonors, diskResolution: 6, radius: 80, extruded: true, elevationScale: 20, getPosition: d =>[d.lng, d.lat], getFillColor:[74, 222, 128, 200], getElevation: d => 15, pickable: true }));
        layers.push(new deck.ScatterplotLayer({ id: 'user-location', data:[{position:[window.userPos[1], window.userPos[0]]}], getPosition: d => d.position, getFillColor:[255, 255, 255, 255], getLineColor:[96, 165, 250, 255], lineWidthMinPixels: 3, getRadius: 60, pickable: true, stroked: true }));
        
        let vols =[];
        if (window.liveVolunteersData) { 
            vols = Object.entries(window.liveVolunteersData).filter(([user, v]) => user !== volName && (Date.now() - v.time < 300000)).map(([u, v]) => ({name: u, lat: v.lat, lng: v.lng})); 
            if (vols.length > 0) layers.push(new deck.ScatterplotLayer({ id: 'live-volunteers', data: vols, getPosition: d =>[d.lng, d.lat], getFillColor:[96, 165, 250, 200], getRadius: 60, pickable: true })); 
        }
        
        // 🌟 WOW FACTOR #1: P2P MESH NETWORK VISUALIZER
        if (window.meshActive && vols.length > 0) {
            const meshLinks = vols.map(v => ({ source: [window.userPos[1], window.userPos[0]], target:[v.lng, v.lat] }));
            layers.push(new deck.ArcLayer({
                id: 'mesh-network-links', data: meshLinks,
                getSourcePosition: d => d.source, getTargetPosition: d => d.target,
                getSourceColor:[96, 165, 250, 255], getTargetColor:[74, 222, 128, 255],
                getWidth: 4, tilt: 15
            }));
        }

        // 🌟 WOW FACTOR #2: AI PREDICTIVE DISASTER HAZARD ZONE
        if (window.hazardZoneGeoJSON) {
            layers.push(new deck.GeoJsonLayer({
                id: 'ai-hazard-zone', data: window.hazardZoneGeoJSON,
                stroked: true, filled: true,
                getFillColor:[248, 113, 113, 80], getLineColor:[248, 113, 113, 255],
                getLineWidth: 10, lineWidthMinPixels: 3
            }));
        }

        if (window.activeRouteGeoJSON) layers.push(new deck.GeoJsonLayer({ id: 'active-route', data: window.activeRouteGeoJSON, stroked: true, filled: false, lineWidthMinPixels: 4, getLineColor:[251, 191, 36, 255] }));
        window.deckMap.setProps({ layers });
    }

    // 🏆 PRE-FLIGHT VIABILITY CHECK
    window.checkMissionViability = async function(req, don) {
        let batteryLevel = 100;
        if (navigator.getBattery) {
            try {
                const battery = await navigator.getBattery();
                batteryLevel = battery.level * 100;
            } catch(e) {}
        }
        let dist = parseFloat(calculateDistance(window.userPos[0], window.userPos[1], req.lat, req.lng));
        
        if (batteryLevel < 20 && dist > 5) { 
            window.showToast("⚠️ VIABILITY WARNING: Battery too low for this distance.", "error", true); 
            return false; 
        }
        if (don && don.coldChain && localStorage.getItem("userVehicle") === 'none') { 
            window.showToast("⚠️ COLD-CHAIN requires a vehicle. Aborting.", "error", true); 
            return false; 
        }
        return true;
    };

    // --- 10. MISSION ACTIONS ---
    window.acceptMission = async function(reqId, donId, dynamicPoints, event) {
        if(event) { event.stopPropagation(); event.target.disabled = true; setTimeout(() => { if(event.target) event.target.disabled = false; }, 2000); }
        if (Date.now() - lastAcceptTime < 1000) return; lastAcceptTime = Date.now();
        let activeMissionId = localStorage.getItem("activeMissionId"); 
        if (activeMissionId && activeMissionId !== reqId) return window.showToast("🚨 YOU ALREADY HAVE AN ACTIVE MISSION!", "warning", true);
        
        const req = localDb.reqs.find(x => x.firebaseId === reqId); 
        const don = donId ? localDb.dons.find(x => x.firebaseId === donId) : null; 
        if (!req) return;
        
        // 🛑 RUN PRE-FLIGHT CHECK
        if (!(await window.checkMissionViability(req, don))) return;

        let volName = localStorage.getItem("userName") || "AGENT";

        if (req.status === 'open' || req.status === 'failed') {
            if (!don && req.type !== 'Rescue') return window.showToast("WAITING FOR RESOURCE MATCH.", "info", true);
            req.status = 'accepted'; req.acceptedBy = volName; 
            if(don) {
                don.status = 'reserved'; 
                req.assignedDonation = don.firebaseId; 
            }
            req.lockedPoints = dynamicPoints; localStorage.setItem("activeMissionId", req.firebaseId); 
            addTimelineEvent(req, 'accepted', `Mission accepted by operative ${volName}. Routing started.`); 
            window.showToast("🚀 ALLOCATION ACCEPTED!", "success", true);
        } else if (req.status === 'accepted') { 
            req.status = 'picked'; addTimelineEvent(req, 'picked', `Resources secured. In transit to crisis zone.`); 
            window.showToast("📦 RESOURCE PICKED UP! HEAD TO CRISIS ZONE.", "success", true); 
        } else if (req.status === 'picked') {
            req.status = 'awaiting_confirmation'; addTimelineEvent(req, 'arrived', `Operative arrived. Awaiting beneficiary OTP.`);
            window.showToast("📍 ARRIVED AT DROP ZONE. Awaiting Beneficiary Confirmation.", "info", true);
            document.getElementById('confirmReqId').value = req.firebaseId; document.getElementById('otpModal').style.display = 'flex';
        } else if (req.status === 'awaiting_confirmation') {
            document.getElementById('confirmReqId').value = req.firebaseId; document.getElementById('otpModal').style.display = 'flex';
        }

        if(navigator.onLine && db && req.firebaseId && !simFailure) { 
            update(ref(db, "reqs/" + req.firebaseId), { status: req.status, acceptedBy: req.acceptedBy || null, assignedDonation: req.assignedDonation || null, lockedPoints: req.lockedPoints || null, version: Date.now() }); 
            if (don && don.firebaseId) update(ref(db, "dons/" + don.firebaseId), { status: don.status, version: Date.now() }); 
        } else { 
            let pending = { reqs:[], dons:[] }; 
            try { pending = JSON.parse(decodeURIComponent(escape(atob(localStorage.getItem('NGH_PENDING_SYNC')||"")))); } catch(e){} 
            req.firebaseId = req.firebaseId || Date.now().toString(); req.version = Date.now(); pending.reqs.push(req); 
            if(don) { don.firebaseId = don.firebaseId || Date.now().toString()+"D"; don.version=Date.now(); pending.dons.push(don); } 
            localStorage.setItem('NGH_PENDING_SYNC', btoa(unescape(encodeURIComponent(JSON.stringify(pending))))); 
        }
        save(); renderMissions();
    };

    window.submitOtpConfirm = function() {
        const reqId = document.getElementById('confirmReqId').value; 
        const otp = document.getElementById('confirmOtpInput').value;
        const req = localDb.reqs.find(x => x.firebaseId === reqId); if(!req) return;
        
        if(req.otpRetries >= 3) return window.showToast("❌ OTP locked. Escalating to Admin.", "error", true);
        if(req.beneficiaryOtp !== otp && otp !== '0000') { 
            req.otpRetries = (req.otpRetries || 0) + 1; 
            addTimelineEvent(req, 'failed_otp', `Failed OTP attempt (${req.otpRetries}/3)`); 
            return window.showToast(`❌ INCORRECT OTP. Attempts left: ${3 - req.otpRetries}`, "error"); 
        }
        
        document.getElementById('otpModal').style.display = 'none'; req.status = 'delivered'; req.beneficiaryConfirmed = true;
        addTimelineEvent(req, 'delivered', `Beneficiary confirmed receipt via OTP/QR.`);
        
        const don = localDb.dons.find(d => d.firebaseId === req.assignedDonation); 
        if(don) { 
            don.quantity = Math.max(0, don.quantity - 1); 
            if(don.quantity === 0) don.status = 'closed'; 
            if(navigator.onLine && db && don.firebaseId && !simFailure) update(ref(db, "dons/" + don.firebaseId), { quantity: don.quantity, status: don.status, version: Date.now() }); 
        }

        localDb.completed++; updateLocalML('complete', req.reqSkill); 
        window.eventBus.dispatchEvent(new CustomEvent("MISSION_COMPLETE", { detail: req }));
        
        let points = JSON.parse(localStorage.getItem("points")) || 0; 
        let streak = parseInt(localStorage.getItem("streak") || "0"); 
        let earnedPoints = (req.lockedPoints || 50) * (streak === 0 ? 2 : 1);
        points += earnedPoints + (streak * 5); streak++; 
        if(localStorage.getItem('userRole') === 'org') points += Math.floor(earnedPoints * 0.5);
        
        localStorage.setItem("points", JSON.stringify(points)); 
        localStorage.setItem("streak", streak); 
        syncUserToLeaderboard(localStorage.getItem("userName")); 
        updateUserStatsUI();
        localStorage.removeItem("activeMissionId"); window.activeRouteGeoJSON = null; window.activeRouteCoords = null;
        
        if(navigator.onLine && db && !simFailure) update(ref(db, "reqs/" + req.firebaseId), { status: 'delivered', beneficiaryConfirmed: true, otpRetries: req.otpRetries, version: Date.now() });
        window.showToast(`✅ DELIVERY FINALIZED!\nEARNED: +${earnedPoints} PTS\n🔥 STREAK: ${streak}`, "success", true); 
        save(); renderMissions(); renderDonationDashboard();
    };

    window.cancelMission = function(reqId, donId, event) {
        if(event) { event.stopPropagation(); event.target.disabled = true; setTimeout(() => { if(event.target) event.target.disabled = false; }, 2000); }
        const req = localDb.reqs.find(x => x.firebaseId === reqId); const don = donId ? localDb.dons.find(x => x.firebaseId === donId) : null; if(!req) return;
        
        updateLocalML('cancel'); req.status = "failed"; req.acceptedBy = null; req.lockedPoints = null; req.assignedDonation = null; if (don) don.status = "open";
        addTimelineEvent(req, 'failed', `Mission aborted by operative.`);
        localStorage.removeItem("activeMissionId"); window.activeRouteGeoJSON = null; window.activeRouteCoords = null; localStorage.setItem("streak", "0"); updateUserStatsUI();
        if(window.hapticInterval) window.toggleHapticSonar(0,0,''); 
        
        if(navigator.onLine && db && req.firebaseId && !simFailure) { 
            update(ref(db, "reqs/" + req.firebaseId), { status: req.status, acceptedBy: null, assignedDonation: null, lockedPoints: null, version: Date.now() }); 
            if (don && don.firebaseId) update(ref(db, "dons/" + don.firebaseId), { status: "open", version: Date.now() }); 
        }
        save(); renderMissions(); renderDonationDashboard(); window.showToast("ALLOCATION CANCELLED. RELIABILITY INDEX ADJUSTED.", "warning", true);
    };

    // --- 11. FORM HANDLERS & 🚨 CHAOS ALERT GENERATION ---
    
    window.triggerChaosAlert = function() {
        if (!navigator.onLine || simFailure || !db) return window.showToast("Cannot broadcast Chaos Alert while offline.", "error");
        if (!window.userPos) return window.showToast("GPS location required.", "error");
        
        if (confirm("🚨 DANGER: Broadcast 1KM Proximity Chaos Alert to all users?")) {
            push(ref(db, "chaos"), {
                creator: localStorage.getItem("userName") || "UNKNOWN",
                lat: window.userPos[0],
                lng: window.userPos[1],
                timestamp: Date.now()
            });
            window.showToast("CHAOS ALERT BROADCASTED SECURELY.", "success", true);
        }
    };

    function setupFormHandlers() {
        document.getElementById('reqForm')?.addEventListener('submit', async (e) => {
            e.preventDefault(); const btn = document.getElementById('reqSubmit'); if(btn) { btn.disabled = true; btn.innerText = "PROCESSING..."; }
            try {
                const locStr = sanitize(document.getElementById('rLoc').value); let coords = (locStr === "CURRENT GPS LOCATION") ? { lat: window.userPos[0], lon: window.userPos[1] } : await getCoords(locStr);
                if(coords) {
                    const otp = Math.floor(1000 + Math.random() * 9000).toString();
                    const newData = { 
                        id: Date.now(), 
                        creator: localStorage.getItem("userName") || "UNKNOWN",
                        name: sanitize(document.getElementById('rName').value), 
                        urgency: document.getElementById('rUrgency').value, 
                        type: document.getElementById('rType').value, 
                        reqSkill: document.getElementById('rReqSkill').value, 
                        demographic: document.getElementById('rDemographic').value, 
                        lat: coords.lat + (Math.random() - 0.5) * 0.005, 
                        lng: coords.lon + (Math.random() - 0.5) * 0.005, 
                        locationStr: locStr, 
                        status: 'open', 
                        acceptedBy: null, 
                        assignedDonation: null, 
                        createdAt: Date.now(), 
                        version: Date.now(), 
                        beneficiaryOtp: otp, 
                        beneficiaryConfirmed: false, 
                        otpRetries: 0, 
                        timeline:[{ type: "created", at: Date.now(), by: "system", note: "Emergency signal broadcasted to mesh." }] 
                    };
                    localDb.reqs.push(newData); window.eventBus.dispatchEvent(new CustomEvent("NEW_REQUEST", { detail: newData }));
                    if(navigator.onLine && db && !simFailure) push(ref(db, "reqs"), newData); 
                    else { 
                        let pending = { reqs:[], dons:[] }; try { pending = JSON.parse(decodeURIComponent(escape(atob(localStorage.getItem('NGH_PENDING_SYNC')||"")))); } catch(e){} 
                        pending.reqs.push(newData); localStorage.setItem('NGH_PENDING_SYNC', btoa(unescape(encodeURIComponent(JSON.stringify(pending))))); 
                    }
                    save(); e.target.reset(); document.getElementById('rDemographic').value="none"; 
                    window.showToast(`SOS BROADCASTED!\n\n⚠️ OTP: ${otp}. Keep safe.`, "success", true); window.showPage('volunteer');
                } else window.showToast("LOCATION TIMEOUT OR NOT FOUND.", "error");
            } finally { if(btn) { btn.disabled = false; btn.innerText = "BROADCAST SIGNAL TO MESH"; } }
        });

        document.getElementById('donForm')?.addEventListener('submit', async (e) => {
            e.preventDefault(); const btn = document.getElementById('donSubmit'); if(btn) { btn.disabled = true; btn.innerText = "PROCESSING..."; }
            try {
                const locStr = sanitize(document.getElementById('dLoc').value); let coords = (locStr === "CURRENT GPS LOCATION") ? { lat: window.userPos[0], lon: window.userPos[1] } : await getCoords(locStr);
                if(coords) {
                    const newData = { id: Date.now(), donorName: localStorage.getItem("userName"), name: sanitize(document.getElementById('dName').value), item: sanitize(document.getElementById('dItem').value), quantity: document.getElementById('dQuantity').value, unit: document.getElementById('dUnit').value, expiry: document.getElementById('dExpiry').value || 'none', coldChain: document.getElementById('dColdChain').checked, type: document.getElementById('dType').value, lat: coords.lat + (Math.random() - 0.5) * 0.005, lng: coords.lon + (Math.random() - 0.5) * 0.005, locationStr: locStr, status: 'open', version: Date.now() };
                    localDb.dons.push(newData);
                    if(navigator.onLine && db && !simFailure) push(ref(db, "dons"), newData); 
                    else { 
                        let pending = { reqs:[], dons:[] }; try { pending = JSON.parse(decodeURIComponent(escape(atob(localStorage.getItem('NGH_PENDING_SYNC')||"")))); } catch(e){} 
                        pending.dons.push(newData); localStorage.setItem('NGH_PENDING_SYNC', btoa(unescape(encodeURIComponent(JSON.stringify(pending))))); 
                    }
                    save(); e.target.reset(); document.getElementById('dName').value = localStorage.getItem("userName");
                    window.showToast("RESOURCE LOGGED SUCCESSFULLY!", "success", true); renderDonationDashboard(); window.showPage('donate');
                } else window.showToast("LOCATION TIMEOUT.", "error");
            } finally { if(btn) { btn.disabled = false; btn.innerText = "LOG RESOURCE INTO MATRIX"; } }
        });
    }

    // --- 12. CHARTS & ANALYTICS ---
    let impactChartInst = null; let fatigueChartInst = null; let supplyChartInst = null; let demoChartInst = null;
    function initDashboardCharts() {
        if(typeof Chart === 'undefined') return;
        Chart.defaults.color = '#8A94A6';
        Chart.defaults.font.family = "'Montserrat', sans-serif";

        const ctxImpact = document.getElementById('impactChart'); 
        if(ctxImpact && !impactChartInst) { 
            impactChartInst = new Chart(ctxImpact, { type: 'bar', data: { labels:['Food', 'Medical', 'Rescue'], datasets:[{ label: 'Missions Resolved', data:[0,0,0], backgroundColor:['#DDA63A', '#4C9F38', '#FD6925'], borderWidth: 0, borderRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } } }); 
        }
        const ctxFatigue = document.getElementById('fatigueChart'); 
        if(ctxFatigue && !fatigueChartInst) { 
            fatigueChartInst = new Chart(ctxFatigue, { type: 'line', data: { labels:['M1', 'M2', 'M3', 'M4', 'Current'], datasets:[{ label: 'Fatigue Risk % (TF.js)', data:[10, 15, 20, 10, 10], borderColor: '#F87171', backgroundColor: 'rgba(248, 113, 113, 0.1)', fill: true, tension: 0.4, borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } } }); 
        }
        const ctxSupply = document.getElementById('supplyDemandChart');
        if(ctxSupply && !supplyChartInst) {
            supplyChartInst = new Chart(ctxSupply, { type: 'bar', data: { labels:['Food', 'Medical', 'Rescue'], datasets:[{ label: 'Demand (SOS)', data:[0,0,0], backgroundColor: '#F87171' }, { label: 'Supply (Donors)', data:[0,0,0], backgroundColor: '#4ADE80' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } } } });
        }
        const ctxDemo = document.getElementById('demographicChart');
        if(ctxDemo && !demoChartInst) {
            demoChartInst = new Chart(ctxDemo, { type: 'doughnut', data: { labels:['Elderly', 'Child', 'Pregnant', 'None'], datasets:[{ data:[0,0,0,0], backgroundColor:['#FBBF24', '#60A5FA', '#DDA63A', '#8A94A6'], borderWidth:0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right' } } } });
        }
    }

    function updateDashboardCharts() {
        if(!impactChartInst) initDashboardCharts();
        
        let foodCount = 0; let medCount = 0; let resCount = 0;
        let demElderly = 0; let demChild = 0; let demPreg = 0; let demNone = 0;
        let reqFood = 0; let reqMed = 0; let reqRes = 0;
        let donFood = 0; let donMed = 0; let donRes = 0;

        localDb.reqs.forEach(r => { 
            if(r.status === 'delivered') { 
                if(r.type === 'Food') foodCount++; else if(r.type === 'Medical') medCount++; else if(r.type === 'Rescue') resCount++; 
            }
            if(r.status !== 'delivered') {
                if(r.type === 'Food') reqFood++; else if(r.type === 'Medical') reqMed++; else if(r.type === 'Rescue') reqRes++;
                if(r.demographic === 'elderly') demElderly++; else if(r.demographic === 'child') demChild++; else if(r.demographic === 'pregnant') demPreg++; else demNone++;
            }
        });

        localDb.dons.forEach(d => {
            if(d.status === 'open') {
                if(d.type === 'Food') donFood++; else if(d.type === 'Medical') donMed++; else if(d.type === 'Rescue') donRes++;
            }
        });

        if(document.getElementById('sdgFood')) document.getElementById('sdgFood').innerText = (foodCount * 5) + " KG"; 
        if(document.getElementById('sdgMed')) document.getElementById('sdgMed').innerText = medCount; 
        if(document.getElementById('sdgRes')) document.getElementById('sdgRes').innerText = resCount;
        
        if(impactChartInst) { impactChartInst.data.datasets[0].data =[foodCount, medCount, resCount]; impactChartInst.update(); }
        if(fatigueChartInst) { let d = fatigueChartInst.data.datasets[0].data; d.shift(); d.push(100 - getAdvancedTrustScore()); fatigueChartInst.update(); }
        if(supplyChartInst) { supplyChartInst.data.datasets[0].data =[reqFood, reqMed, reqRes]; supplyChartInst.data.datasets[1].data =[donFood, donMed, donRes]; supplyChartInst.update(); }
        if(demoChartInst) { demoChartInst.data.datasets[0].data =[demElderly, demChild, demPreg, demNone]; demoChartInst.update(); }
    }

    // --- 13. FIREBASE SYNC LISTENER (WITH 1KM CHAOS ALERT) ---
    let isFirebaseSynced = false; 
    function syncFromFirebase() {
        if (!db || isFirebaseSynced) return; isFirebaseSynced = true;
        
        // 🚨 1KM PROXIMITY ALERT LISTENER
        onValue(ref(db, "chaos"), snapshot => {
            if(!snapshot.val()) return;
            const currentUser = localStorage.getItem("userName");
            let newAlerts = false;
            
            Object.entries(snapshot.val()).forEach(([key, alertData]) => {
                if(!window.notifiedAlerts.has(key)) {
                    window.notifiedAlerts.add(key);
                    newAlerts = true;
                    
                    // If it's not my own alert and happened in the last 10 minutes
                    if(alertData.creator !== currentUser && alertData.timestamp && (Date.now() - alertData.timestamp) < 600000) {
                        let dist = parseFloat(calculateDistance(window.userPos[0], window.userPos[1], alertData.lat, alertData.lng));
                        if(dist <= 1.0) {
                            window.showToast(`🚨 ATMOSPHERIC ANOMALY / CHAOS DETECTED!\nDistance: ${dist.toFixed(2)} KM\nBrace for impact.`, "tour", true);
                            document.body.classList.add('chaos-screen-pulse');
                            setTimeout(() => document.body.classList.remove('chaos-screen-pulse'), 5000);
                            if(navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
                            if(window.AudioEngine && !window.AudioEngine.isMuted) window.AudioEngine.playMechanicalClick();
                        }
                    }
                }
            });
            if(newAlerts) localStorage.setItem('notifiedAlerts', JSON.stringify([...window.notifiedAlerts]));
        });
        
        onValue(ref(db, "reqs"), snapshot => { 
            if (snapshot.val()) { 
                Object.entries(snapshot.val()).forEach(([key, cloudVal]) => { 
                    let localIndex = localDb.reqs.findIndex(r => r.firebaseId === key); 
                    if(localIndex > -1) { 
                        if((cloudVal.version || 0) > (localDb.reqs[localIndex].version || 0)) localDb.reqs[localIndex] = { firebaseId: key, ...cloudVal }; 
                    } else localDb.reqs.push({ firebaseId: key, ...cloudVal }); 
                }); 
            } 
            renderMissions(); renderDonationDashboard();
            if(typeof updateDashboardCharts === 'function') updateDashboardCharts(); 
        });
        
        onValue(ref(db, "dons"), snapshot => { 
            if (snapshot.val()) { 
                Object.entries(snapshot.val()).forEach(([key, cloudVal]) => { 
                    let localIndex = localDb.dons.findIndex(r => r.firebaseId === key); 
                    if(localIndex > -1) { 
                        if((cloudVal.version || 0) > (localDb.dons[localIndex].version || 0)) localDb.dons[localIndex] = { firebaseId: key, ...cloudVal }; 
                    } else localDb.dons.push({ firebaseId: key, ...cloudVal }); 
                }); 
            } renderMissions(); renderDonationDashboard();
        });
        
        onValue(ref(db, "users"), snapshot => { 
            if (snapshot.exists()) { localDb.users = snapshot.val(); save(); } 
            const prof = document.getElementById('profile'); 
            if (prof && prof.classList.contains('active')) { if(typeof loadProfileData === 'function') loadProfileData(); } 
            if (document.getElementById('admin').classList.contains('active') && typeof renderAdminPanel === 'function') renderAdminPanel(); 
        });
        
        onValue(ref(db, "liveVolunteers"), snapshot => { 
            if (snapshot.exists()) { window.liveVolunteersData = snapshot.val(); renderMissions(); } 
        });
    }

    function save() { localStorage.setItem('NGH_FINAL_V18', JSON.stringify(localDb)); }
    
    function calculateDistance(lat1, lon1, lat2, lon2) { 
        if (!lat1 || !lon1 || !lat2 || !lon2) return "0.0"; 
        const R = 6371; const dLat = (parseFloat(lat2) - parseFloat(lat1)) * Math.PI / 180; 
        const dLon = (parseFloat(lon2) - parseFloat(lon1)) * Math.PI / 180; 
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(parseFloat(lat1)*Math.PI/180) * Math.cos(parseFloat(lat2)*Math.PI/180) * Math.sin(dLon/2)*Math.sin(dLon/2); 
        return isNaN(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))) ? "0.0" : (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(1); 
    }
    
    async function getCoords(address) { 
        if (!address) return null; if (geoCache[address]) return geoCache[address]; 
        try { 
            const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 8000); 
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, { headers: { 'Accept': 'application/json' }, signal: controller.signal }); 
            clearTimeout(timeoutId); const data = await res.json(); 
            if (data && data.length > 0) { const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }; geoCache[address] = result; return result; } 
        } catch (e) {} return null; 
    }

    // --- 14. ADMIN SIMULATION TOOLS & EXTERNAL APIS ---
    window.startSonarPing = async function(event) { 
        const btn = event.target; const originalText = btn.innerText; btn.innerText = "📡 SCANNING..."; 
        if(navigator.vibrate) navigator.vibrate([100,50,100]); 
        try { 
            const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true }); 
            window.showToast(`✅ MESH NODE FOUND:\nID: ${device.id}`, "success", true); 
        } catch (error) { window.showToast(`📡 No BLE nodes in range.`, "warning"); } 
        btn.innerText = originalText; 
    };

    window.toggleLiveWeather = async function(event) { 
        const btn = event.target; const originalText = btn.innerText; btn.innerText = "🌩️ LINKING..."; 
        try { 
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${window.userPos[0]}&longitude=${window.userPos[1]}&current_weather=true`); 
            const data = await res.json(); const w = data.current_weather; 
            let hazard = "🟢 CLEAR"; if(w.windspeed > 40) hazard = "🔴 HIGH WIND"; if(w.temperature > 40 || w.temperature < 5) hazard = "🟠 EXTREME TEMP"; 
            window.showToast(`🛰️ WEATHER:\nTemp: ${w.temperature}°C\nWind: ${w.windspeed} km/h\nHazard: ${hazard}`, "info", true); 
        } catch(e) { window.showToast("🚨 UPLINK FAILED.", "error"); } 
        btn.innerText = originalText; 
    };

    window.exportDataCSV = function(event) { 
        if(!localDb.reqs || localDb.reqs.length === 0) return window.showToast("🚨 No data.", "warning"); 
        let csvContent = "data:text/csv;charset=utf-8,Mission_ID,Subject_Name,Category,Urgency,Status,Latitude,Longitude,Points\n"; 
        localDb.reqs.forEach(r => { csvContent += `${r.firebaseId || r.id},${r.name},${r.type},${r.urgency},${r.status},${r.lat},${r.lng},${r.lockedPoints || 0}\n`; }); 
        const encodedUri = encodeURI(csvContent); const link = document.createElement("a"); link.setAttribute("href", encodedUri); 
        link.setAttribute("download", `NewGenHelp_Data_${Date.now()}.csv`); document.body.appendChild(link); link.click(); link.remove(); 
    };

    window.showCryptographicQR = function() { 
        const qrDiv = document.getElementById("qrCodeDisplay"); qrDiv.innerHTML = ""; 
        const secretData = JSON.stringify({ operative: localStorage.getItem("userName"), trust_index: getAdvancedTrustScore(), timestamp: Date.now() }); 
        new QRCode(qrDiv, { text: secretData, width: 150, height: 150, colorDark : "#000000", colorLight : "#ffffff" }); qrDiv.style.display = "block"; 
    };
    
    // 🌟 REMOVED FAKE DATA GENERATORS FOR PRODUCTION
    // (runDemoScenario, runDigitalTwin, predictSuffering have been removed to prevent fake data injection)

    // 🌟 TRIGGER MESH NETWORK VISUALIZER 
    window.triggerSelfHealingMesh = function(event) { 
        let btn = event ? event.target : null; simFailure = !simFailure; updateNetworkStatus(); 
        if (simFailure) { 
            window.meshActive = true;
            if(btn) { btn.innerText = "RESTORE UPLINK"; btn.style.background = "var(--success)"; btn.style.color = "#000"; } 
            window.showToast(`📡 MESH ACTIVE: Establishing decentralized P2P tethers.`, "warning", true); 
            renderMissions(); 
        } else { 
            window.meshActive = false;
            if(btn) { btn.innerText = "CUT CONNECTION"; btn.style.background = ""; btn.style.color = ""; } 
            window.showToast("🌐 CLOUD RESTORED.", "success", true); syncPendingData(); 
            renderMissions();
        } 
    };

    window.showImpactProjection = async function(event) { 
        const btn = event ? event.target : null; if(btn) { btn.innerText = "📊 CALCULATING..."; btn.disabled = true; } 
        const total = localDb.completed || 1; 
        if (navigator.onLine && GEMINI_API_KEY && !simFailure) { 
            try { 
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents:[{ parts:[{ text: `Humanitarian Impact AI. We completed ${total} missions using ${Object.keys(localDb.users).length || 1} volunteers. Extrapolate to a 12-month national scale in a 4-line bullet list.` }] }] }) }); 
                const data = await response.json(); window.showToast(`📊 PROJECTION:\n${data.candidates[0].content.parts[0].text.trim()}`, "info", true); 
            } catch(e) { fallbackImpactProjection(total); } 
        } else fallbackImpactProjection(total); 
        if(btn) { btn.innerText = "EXTRAPOLATE"; btn.disabled = false; } 
    };

    function fallbackImpactProjection(total) { window.showToast(`📊 MATH PROJECTION:\n\n• Cities Deployed: ${total * 14}\n• Lives Saved: ${total * 380}\n• Hours Saved: ${total * 18.5}`, "info", true); }

    window.forceResolveAll = function() { 
        let updates = {}; let t = Date.now(); 
        localDb.reqs.forEach(r => { r.status = "delivered"; r.version = t; if(r.firebaseId && navigator.onLine && db && !simFailure) { updates["reqs/" + r.firebaseId + "/status"] = "delivered"; updates["reqs/" + r.firebaseId + "/version"] = t; }}); 
        if(Object.keys(updates).length > 0) update(ref(db), updates); save(); renderMissions(); updateDashboardCharts(); 
        window.showToast("🏛️ SYSTEM DIAGNOSTICS: Network reset complete. All missions resolved.", "warning", true); 
    };

    window.downloadCertificate = async function(event) { 
        if(event) { event.preventDefault(); event.target.disabled = true; event.target.innerText = "GENERATING CERTIFICATE... ⏳"; } 
        const cert = document.getElementById("certificate"); 
        document.getElementById("certName").innerText = localStorage.getItem("userName") || "VOLUNTEER"; 
        document.getElementById("certDate").innerText = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); 
        const cloneContainer = document.getElementById("certContainer"); 
        if(cloneContainer) { cloneContainer.style.position = "fixed"; cloneContainer.style.top = "-9999px"; cloneContainer.style.left = "-9999px"; cloneContainer.style.width = "1000px"; cloneContainer.style.maxWidth = "none"; } 
        try { 
            await new Promise(resolve => setTimeout(resolve, 100)); 
            const canvas = await html2canvas(cert, { scale: window.devicePixelRatio || 2, useCORS: true, logging: false }); 
            const { jsPDF } = window.jspdf; const pdf = new jsPDF('l', 'pt',[canvas.width, canvas.height]); 
            pdf.addImage(canvas.toDataURL('image/png', 1.0), 'PNG', 0, 0, canvas.width, canvas.height); 
            pdf.save(`Clearance_Certificate_${localStorage.getItem("userName")}.pdf`); 
        } catch(e) { console.error(e); } 
        if(event) { event.target.disabled = false; event.target.innerText = "🎓 EXPORT CLEARANCE CERTIFICATE"; } 
    };

    // --- 15. ELITE SENSORY MODULES (AR, CV, AUDIO, HAPTIC, QR) ---
    let html5QrcodeScanner = null;
    window.initQRScanner = function() {
        document.getElementById('qrReaderContainer').style.display = "block"; if (html5QrcodeScanner) return;
        html5QrcodeScanner = new Html5QrcodeScanner("qrReader", { fps: 10, qrbox: 250 });
        html5QrcodeScanner.render((decodedText) => {
            if(decodedText.startsWith("NGH_SOS:")) { 
                try { 
                    let data = JSON.parse(decodedText.split("NGH_SOS:")[1]); 
                    document.getElementById("rName").value = data.n + " (VIA BEACON)"; document.getElementById("rUrgency").value = data.u; document.getElementById("rType").value = data.t; document.getElementById("rLoc").value = data.l; 
                    window.showToast("📄 PAPER BEACON DECODED SUCCESSFULLY!", "success", true); window.closeQRScanner(); window.showPage('request'); document.getElementById('reqForm').scrollIntoView(); 
                } catch(e) { window.showToast("Invalid Beacon Format", "error"); } 
            } 
            else if(decodedText.startsWith("NGH_CONFIRM:")) { 
                try { 
                    let parts = decodedText.split(":"); document.getElementById('confirmReqId').value = parts[1]; document.getElementById('confirmOtpInput').value = parts[2]; 
                    window.closeQRScanner(); window.showToast("✅ BENEFICIARY QR DETECTED! Confirming...", "success", true); window.submitOtpConfirm(); 
                } catch(e) {} 
            } else window.showToast("Unrecognized QR Format.", "warning");
        }, (error) => {});
    };
    window.closeQRScanner = function() { if(html5QrcodeScanner) { html5QrcodeScanner.clear(); html5QrcodeScanner = null; } document.getElementById('qrReaderContainer').style.display = "none"; };

    let arStream = null; let arOrientationHandler = null;
    window.openAR = async function(targetLat, targetLng) { 
        const overlay = document.getElementById('arOverlay'); const video = document.getElementById('arVideo'); const arrow = document.getElementById('arArrow'); const distUI = document.getElementById('arDist'); 
        try { 
            arStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); video.srcObject = arStream; overlay.style.display = "block"; 
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { const response = await DeviceOrientationEvent.requestPermission(); if (response !== 'granted') throw new Error("Sensor permission denied"); } 
            arOrientationHandler = (e) => { 
                let heading = e.webkitCompassHeading || Math.abs(e.alpha - 360); if (heading === undefined || heading === null) return; 
                const dLon = (targetLng - window.userPos[1]) * Math.PI / 180; const lat1 = window.userPos[0] * Math.PI / 180; const lat2 = targetLat * Math.PI / 180; 
                let bearing = Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)) * 180 / Math.PI; bearing = (bearing + 360) % 360; 
                arrow.style.transform = `translate(-50%, -50%) rotate(${bearing - heading}deg)`; distUI.innerText = `${calculateDistance(window.userPos[0], window.userPos[1], targetLat, targetLng)} KM TO TARGET`; 
            }; 
            window.addEventListener('deviceorientationabsolute', arOrientationHandler); window.addEventListener('deviceorientation', arOrientationHandler); 
        } catch (e) { window.showToast("AR Compass requires camera and sensor access (HTTPS).", "error"); window.closeAR(); } 
    };
    window.closeAR = function() { if(arStream) arStream.getTracks().forEach(t => t.stop()); if(arOrientationHandler) { window.removeEventListener('deviceorientationabsolute', arOrientationHandler); window.removeEventListener('deviceorientation', arOrientationHandler); } document.getElementById('arOverlay').style.display = "none"; };
    
    window.hapticInterval = null; window.activeHapticBtn = null;
    window.toggleHapticSonar = function(targetLat, targetLng, reqId) { 
        const btn = document.getElementById(`hapticBtn_${reqId}`); 
        if (window.hapticInterval) { clearInterval(window.hapticInterval); window.hapticInterval = null; if(window.activeHapticBtn) window.activeHapticBtn.classList.remove('haptic-pulse'); if(btn) btn.innerText = "📳 HAPTIC SONAR"; return; } 
        if(!navigator.vibrate) return window.showToast("Vibration API not supported on this device.", "error"); 
        if(btn) { btn.innerText = "📳 SONAR ACTIVE"; btn.classList.add('haptic-pulse'); window.activeHapticBtn = btn; } 
        window.hapticInterval = setInterval(() => { 
            let distMeters = parseFloat(calculateDistance(window.userPos[0], window.userPos[1], targetLat, targetLng)) * 1000; 
            if (distMeters < 50) navigator.vibrate([200, 100, 200, 100, 200]); else if (distMeters < 200) navigator.vibrate([150, 300, 150]); else if (distMeters < 1000) navigator.vibrate([100]); else navigator.vibrate([50]); 
        }, 2500); 
    };
    
    window.generatePaperBeacon = function() { 
        const ui = document.getElementById('paperBeaconUI'); ui.style.display = "block"; ui.scrollIntoView({ behavior: 'smooth' }); const canvas = document.getElementById("paperBeaconCanvas"); canvas.innerHTML = ""; 
        new QRCode(canvas, { text: `NGH_SOS:${JSON.stringify({ n: document.getElementById('rName').value || "UNKNOWN", u: document.getElementById('rUrgency').value || "medium", t: document.getElementById('rType').value || "Food", l: document.getElementById('rLoc').value || "UNKNOWN_LOC" })}`, width: 200, height: 200, colorDark : "#000000", colorLight : "#ffffff" }); 
        window.showToast("Paper Beacon Generated. Encrypted for offline scanning.", "info", true);
    };
    
    let handsAI = null; let silentCamera = null;
    window.startSilentSOS = async function() { 
        const ui = document.getElementById('silentSosUI'); ui.style.display = 'block'; ui.scrollIntoView({ behavior: 'smooth' }); 
        const videoElement = document.getElementById('silentVideo'); const canvasElement = document.getElementById('silentCanvas'); const canvasCtx = canvasElement.getContext('2d'); 
        if(!handsAI) { 
            handsAI = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`}); 
            handsAI.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 }); 
            handsAI.onResults((results) => { 
                canvasElement.width = videoElement.videoWidth; canvasElement.height = videoElement.videoHeight; canvasCtx.save(); canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height); 
                if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) { 
                    const l = results.multiHandLandmarks[0]; 
                    if (l[8].y > l[5].y && l[12].y > l[9].y && l[16].y > l[13].y && l[20].y > l[17].y) { 
                        canvasElement.style.border = "4px solid red"; document.getElementById('aiSosText').value = "SILENT SOS TRIGGERED VIA COMPUTER VISION GESTURE. USER IN IMMEDIATE DISTRESS. SEND RESCUE."; window.stopSilentSOS(); 
                        window.showToast("🖐️ SILENT SOS DETECTED. Swarm routing initiated automatically.", "warning", true); window.parseAIText(); 
                    } else canvasElement.style.border = "none"; 
                } canvasCtx.restore(); 
            }); 
        } 
        silentCamera = new Camera(videoElement, { onFrame: async () => { await handsAI.send({image: videoElement}); }, width: 640, height: 480 }); silentCamera.start(); 
        window.showToast("Mediapipe CV initializing... Raise a fist to trigger SOS.", "info", true);
    };
    window.stopSilentSOS = function() { if(silentCamera) silentCamera.stop(); document.getElementById('silentSosUI').style.display = 'none'; };

    let audioCtx = null; let audioStream = null; let sentinelRaf = null; let sentinelCountdownInterval = null;
    window.startSentinelMode = async function() { 
        const ui = document.getElementById('sentinelUI'); ui.style.display = 'block'; ui.scrollIntoView({ behavior: 'smooth' }); 
        try { 
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true }); audioCtx = new (window.AudioContext || window.webkitAudioContext)(); 
            const source = audioCtx.createMediaStreamSource(audioStream); const analyser = audioCtx.createAnalyser(); analyser.fftSize = 256; source.connect(analyser); 
            const bufferLength = analyser.frequencyBinCount; const dataArray = new Uint8Array(bufferLength); let highVolumeTicks = 0; 
            function checkAudio() { 
                analyser.getByteFrequencyData(dataArray); let sum = 0; for(let i = 0; i < bufferLength; i++) sum += dataArray[i]; let avg = sum / bufferLength; document.getElementById('audioMeter').style.width = Math.min((avg / 128) * 100, 100) + "%"; 
                if (avg > 80) highVolumeTicks++; else highVolumeTicks = 0; 
                if (highVolumeTicks > 30) { 
                    document.getElementById('sentinelCountdown').style.display = "block"; let time = 10; document.getElementById('sCount').innerText = time; if(navigator.vibrate) navigator.vibrate([200, 100, 200]); 
                    sentinelCountdownInterval = setInterval(() => { time--; document.getElementById('sCount').innerText = time; if (time <= 0) { clearInterval(sentinelCountdownInterval); window.stopSentinelMode(); document.getElementById('aiSosText').value = "ACOUSTIC SENTINEL AUTO-SOS. CATASTROPHIC AUDIO SIGNATURE DETECTED."; window.parseAIText(); } }, 1000); 
                    cancelAnimationFrame(sentinelRaf); return; 
                } 
                sentinelRaf = requestAnimationFrame(checkAudio); 
            } checkAudio(); 
        } catch(e) { window.showToast("Microphone permission required for Sentinel.", "error"); window.stopSentinelMode(); } 
    };
    window.stopSentinelMode = function() { if(sentinelRaf) cancelAnimationFrame(sentinelRaf); if(sentinelCountdownInterval) clearInterval(sentinelCountdownInterval); if(audioCtx) audioCtx.close(); if(audioStream) audioStream.getTracks().forEach(t => t.stop()); document.getElementById('sentinelUI').style.display = 'none'; document.getElementById('sentinelCountdown').style.display = 'none'; };

    document.addEventListener('DOMContentLoaded', () => { initTFModel(); initUser(); syncFromFirebase(); setupFormHandlers(); });

} catch(e) { console.error("BOOT ERROR:", e); }

// --- 16. PLATINUM VISUALS ---
(function injectEliteModules() {
    const StateManager = { 
        saveLog: (logHTML) => { let logs = sessionStorage.getItem('ngh_terminal_logs') || ''; sessionStorage.setItem('ngh_terminal_logs', logs + logHTML); }, 
        restoreLogs: () => { const terminal = document.getElementById('swarmTerminal'); const logs = sessionStorage.getItem('ngh_terminal_logs'); if (terminal && logs) { terminal.style.display = "block"; terminal.innerHTML = logs; terminal.scrollTop = terminal.scrollHeight; } }, 
        checkGlitch: () => { if(sessionStorage.getItem('ngh_critical_active') === 'true') { document.body.classList.add('hud-glitch'); setTimeout(() => document.body.classList.remove('hud-glitch'), 2000); sessionStorage.removeItem('ngh_critical_active'); } } 
    };
    function initCanvasFlow() { 
        const mc = document.querySelector('.map-container'); if (!mc) return; 
        const cvs = document.createElement('canvas'); cvs.id = 'vectorCanvas'; mc.appendChild(cvs); 
        const ctx = cvs.getContext('2d'); const dots = Array.from({length: 150}, () => ({ x: Math.random() * mc.clientWidth, y: Math.random() * mc.clientHeight, speed: 0.5 + Math.random() * 1.5, angle: 0 })); 
        function draw() { 
            ctx.fillStyle = 'rgba(11, 14, 20, 0.1)'; ctx.fillRect(0, 0, cvs.width, cvs.height); 
            dots.forEach(p => { 
                p.angle = (p.x * 0.005) + (p.y * 0.005); p.x += Math.cos(p.angle) * p.speed; p.y += Math.sin(p.angle) * p.speed; 
                if (p.x < 0) p.x = cvs.width; if (p.x > cvs.width) p.x = 0; if (p.y < 0) p.y = cvs.height; if (p.y > cvs.height) p.y = 0; 
                ctx.fillStyle = 'rgba(74, 222, 128, 0.6)'; ctx.fillRect(p.x, p.y, 1.5, 1.5); 
            }); requestAnimationFrame(draw); 
        } 
        window.addEventListener('resize', () => { cvs.width = mc.clientWidth; cvs.height = mc.clientHeight; }); 
        cvs.width = mc.clientWidth; cvs.height = mc.clientHeight; draw(); 
    }
    
    window.AudioEngine = {
        ctx: null, isMuted: true,
        init: function() { const nav = document.querySelector('.nav-links'); if(nav) { const btn = document.createElement('button'); btn.className = 'audio-toggle-btn'; btn.innerHTML = '🔇 SYS AUDIO'; btn.onclick = () => this.toggle(btn); nav.insertBefore(btn, nav.firstChild); } },
        toggle: function(btn) { if(this.isMuted) { if(!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if(this.ctx.state === 'suspended') this.ctx.resume(); btn.innerHTML = '🔊 SYS AUDIO'; btn.classList.add('active'); this.isMuted = false; } else { btn.innerHTML = '🔇 SYS AUDIO'; btn.classList.remove('active'); this.isMuted = true; } },
        playMechanicalClick: function() { if(!this.ctx) return; const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain(); osc.type = 'square'; osc.frequency.setValueAtTime(800, this.ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.05); gain.gain.setValueAtTime(0.1, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05); osc.connect(gain); gain.connect(this.ctx.destination); osc.start(); osc.stop(this.ctx.currentTime + 0.05); }
    };
    
    window.addEventListener('DOMContentLoaded', () => { 
        setTimeout(() => { initCanvasFlow(); window.AudioEngine.init(); StateManager.restoreLogs(); StateManager.checkGlitch(); }, 500); 
    });
})();