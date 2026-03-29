let files = [];
let controllers = {};

const fileInput = document.getElementById("fileInput");
const queue = document.getElementById("queue");

const languageInput = document.getElementById("languageInput");
const languageList = document.getElementById("languageList");
const wrapper = document.querySelector(".dropdown-input-wrapper");

let selectedCode = "";

/* =========================
   LANGUAGE SYSTEM
========================= */

const languages = [
    "Keep Original",
    "English","Spanish","French","German","Italian","Portuguese",
    "Chinese","Japanese","Korean","Arabic","Hindi","Russian",
    "Polish","Turkish","Dutch","Swedish","Greek","Thai","Vietnamese"
];

languageInput.value = "Keep Original";

languageInput.addEventListener("focus", () => {
    if(languageInput.value === "Keep Original"){
        languageInput.value = "";
    }
    renderDropdown(languages);
});

languageInput.addEventListener("input", () => {
    const val = languageInput.value.toLowerCase();
    const filtered = languages.filter(l => l.toLowerCase().includes(val));
    renderDropdown(filtered);
    selectedCode = val === "" ? "" : val;
});

function renderDropdown(list){
    languageList.innerHTML = "";
    languageList.style.display = "block";

    list.forEach(name => {
        const div = document.createElement("div");
        div.className = "dropdown-item";
        div.innerText = name;

        div.onclick = () => {
            languageInput.value = name;
            selectedCode = name === "Keep Original" ? "" : name.toLowerCase();
            languageList.style.display = "none";
        };

        languageList.appendChild(div);
    });
}

document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) {
        languageList.style.display = "none";

        if(languageInput.value.trim() === ""){
            languageInput.value = "Keep Original";
            selectedCode = "";
        }
    }
});

/* ========================= */

function toggleTheme(){
    document.body.classList.toggle("light");
}

/* =========================
   FILE HANDLING
========================= */

fileInput.addEventListener("change", (e) => {
    for(let f of e.target.files){
        files.push(f);
    }
    renderFileList();
});

function renderFileList(){
    const list = document.getElementById("fileList");

    list.innerHTML = files.map((f, i) => `
        <div>
            ${f.name}
            <button onclick="removeFile(${i})">❌</button>
        </div>
    `).join("");
}

function removeFile(index){
    files.splice(index, 1);
    renderFileList();
}

/* =========================
   QUEUE
========================= */

async function startQueue(){

    queue.innerHTML = "";

    const currentFiles = [...files];

    for(let file of currentFiles){
        await processFile(file);
    }

    files = [];
    renderFileList();
}

/* ========================= */

async function processFile(file){

    const index = Date.now() + Math.random();

    const controller = new AbortController();
    controllers[index] = controller;

    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
        <b id="title${index}">${file.name}</b>
        <button onclick="cancelJob('${index}')">Cancel</button>
        <div class="bar"><div class="prog" id="p${index}"></div></div>
        <div id="s${index}">Starting...</div>
        <div class="output" id="out${index}"></div>
        <div id="actions${index}" style="margin-top:10px;"></div>
    `;

    queue.prepend(div);

    const form = new FormData();
    form.append("file", file);
    form.append("language", selectedCode);
    form.append("quality", document.getElementById("quality").value);

    await runStream(form, index, controller);
}

/* ========================= */

function cancelJob(index){
    if(controllers[index]){
        controllers[index].abort();
        delete controllers[index];

        const status = document.getElementById("s"+index);
        if(status){
            status.innerText = "Cancelled";
        }
    }
}

/* =========================
   URL
========================= */

function processUrl(){

    queue.innerHTML = "";

    const url = document.getElementById("videoUrl").value;
    if(!url) return;

    const index = Date.now();

    const controller = new AbortController();
    controllers[index] = controller;

    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
        <b id="title${index}">${url}</b>
        <button onclick="cancelJob('${index}')">Cancel</button>
        <div class="bar"><div class="prog" id="p${index}"></div></div>
        <div id="s${index}">Starting...</div>
        <div class="output" id="out${index}"></div>
        <div id="actions${index}" style="margin-top:10px;"></div>
    `;

    queue.prepend(div);

    const form = new FormData();
    form.append("url", url);
    form.append("language", selectedCode);
    form.append("quality", document.getElementById("quality").value);

    runStream(form, index, controller);
}

/* =========================
   STREAM
========================= */

async function runStream(form, index, controller){

    const status = document.getElementById("s"+index);
    const bar = document.getElementById("p"+index);

    try{
        const res = await fetch("/transcribe-stream", {
            method: "POST",
            body: form,
            signal: controller.signal
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";

        while(true){
            const { done, value } = await reader.read();
            if(done) break;

            buffer += decoder.decode(value, {stream:true});

            let parts = buffer.split("\n\n");
            buffer = parts.pop();

            parts.forEach(chunk=>{
                if(chunk.startsWith("data:")){
                    const data = JSON.parse(chunk.replace("data: ","").trim());
                    updateUI(data, index);
                }
            });
        }

    }catch(err){
        if(err.name === "AbortError"){
            status.innerText = "Cancelled";
        } else {
            status.innerText = "Error";
        }
    }
}

/* ========================= */

function updateUI(data, index){

    const status = document.getElementById("s"+index);
    const bar = document.getElementById("p"+index);

    if(data.title){
        const titleEl = document.getElementById("title"+index);
        if(titleEl) titleEl.innerText = data.title;
    }

    if(data.stage==="downloading"){
        status.innerText="Downloading...";
        bar.style.width="10%";
    }

    if(data.stage==="analyzing"){
        status.innerText="Analyzing...";
        bar.style.width="25%";
    }

    if(data.stage==="enhancing"){
        bar.style.width="45%";
        if(data.seconds !== undefined){
            status.innerText = data.step + "... (" + data.seconds + "s)";
        }
    }

    if(data.stage==="transcribing"){
        bar.style.width="65%";
        if(data.seconds !== undefined){
            status.innerText = "Transcribing... (" + data.seconds + "s)";
        }
    }

    if(data.stage==="done"){
        bar.style.width="100%";
        status.innerText="Done";

        const text = data.text;

        document.getElementById("out"+index).innerHTML =
            formatText(text);

        const actions = document.getElementById("actions"+index);

        const title = (data.title || "transcript")
            .replace(/[^\w\s]/gi, "")
            .replace(/\s+/g, "_")
            .toLowerCase();

        actions.innerHTML = `
            <button onclick="copyText('${index}')">Copy</button>
            <button onclick="downloadText('${index}','${title}')">Download</button>
        `;

        window["text_"+index] = text;
    }

    if(data.stage==="error"){
        status.innerText="Error: " + data.error;
    }
}

/* ========================= */

function copyText(index){
    const text = window["text_"+index];
    navigator.clipboard.writeText(text);
    showToast("Copied!");
}

/* ========================= */

function downloadText(index, filename){
    const text = window["text_"+index];

    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");

    a.href = URL.createObjectURL(blob);
    a.download = filename + ".txt";

    a.click();
}

/* ========================= */

function showToast(message){

    let toast = document.getElementById("toast");

    if(!toast){
        toast = document.createElement("div");
        toast.id = "toast";
        toast.style.position = "fixed";
        toast.style.bottom = "20px";
        toast.style.right = "20px";
        toast.style.background = "#333";
        toast.style.color = "#fff";
        toast.style.padding = "10px 16px";
        toast.style.borderRadius = "8px";
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.3s";
        document.body.appendChild(toast);
    }

    toast.innerText = message;
    toast.style.opacity = "1";

    setTimeout(() => {
        toast.style.opacity = "0";
    }, 1500);
}

/* ========================= */

function formatText(text){
    return text
        .replace(/\s+/g," ")
        .trim()
        .split(/(?<=[.?!])\s+/)
        .map(s=>`<p>${s}</p>`)
        .join("");
}