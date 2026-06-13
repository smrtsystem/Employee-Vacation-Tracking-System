// ======================== COMPLETE JAVASCRIPT ========================
let currentUserRole = null, currentUserName = null;
const users = { 
    admin: { password: "535680", role: "admin", name: "Administrator" }, 
    user: { password: "742744", role: "user", name: "Normal User" } 
};
let autoRefreshInterval = null, employeesData = [], sheetData = [], currentModalPdfIndex = null, editingModalRowId = null;
let monthlyChart = null, statusChart = null;
let tempPdfData = {};
let tempRowCounter = 0;
let animationPlayed = false;
const EMBEDDED_GOOGLE_URL = "https://script.google.com/macros/s/AKfycbyOaEqHirF2nZhAT-jSwTvDSVLFvuwbhKRDaZNJpTsOG2-KrQXGYpwm-YLkTU0KNorh/exec";
const GOOGLE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1yCx5mPGjdvwpQ1mxjq2zRR9Q45MrF_naIhOLUP4terk/edit";
let GOOGLE_URL = EMBEDDED_GOOGLE_URL;

// Theme Toggle Function
function toggleTheme() {
    const body = document.body;
    const themeBtn = document.getElementById('themeToggleBtn');
    const themeText = document.getElementById('themeText');
    
    if (body.classList.contains('dark-mode')) {
        body.classList.remove('dark-mode');
        themeText.innerHTML = 'Dark Mode';
        if (themeBtn) themeBtn.querySelector('i').className = 'fas fa-moon';
        localStorage.setItem('theme', 'light');
    } else {
        body.classList.add('dark-mode');
        themeText.innerHTML = 'Light Mode';
        if (themeBtn) themeBtn.querySelector('i').className = 'fas fa-sun';
        localStorage.setItem('theme', 'dark');
    }
}

// Load saved theme on page load
function loadSavedTheme() {
    const savedTheme = localStorage.getItem('theme');
    const themeBtn = document.getElementById('themeToggleBtn');
    const themeText = document.getElementById('themeText');
    
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        if (themeText) themeText.innerHTML = 'Light Mode';
        if (themeBtn) themeBtn.querySelector('i').className = 'fas fa-sun';
    } else {
        document.body.classList.remove('dark-mode');
        if (themeText) themeText.innerHTML = 'Dark Mode';
        if (themeBtn) themeBtn.querySelector('i').className = 'fas fa-moon';
    }
}

function getToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function calculateVacationDays(departureStr, returnStr) { if(!departureStr || !returnStr) return 0; const start = new Date(departureStr), end = new Date(returnStr); if(isNaN(start) || isNaN(end)) return 0; return Math.ceil((end - start) / 86400000) + 1; }
function formatDateToYMD(dateValue) { if(!dateValue) return ''; const date = new Date(dateValue); if(isNaN(date.getTime())) return ''; return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function parseDateLocal(dateStr) { if(!dateStr) return null; const parts = dateStr.split(/[-/]/); if(parts.length===3) { let y=parseInt(parts[0]), m=parseInt(parts[1])-1, d=parseInt(parts[2]); if(y<1000) { y=parseInt(parts[2]); m=parseInt(parts[1])-1; d=parseInt(parts[0]); } return new Date(y,m,d); } return null; }
function getTodayMessage(departureStr, returnStr) { const today=getToday(), dep=parseDateLocal(departureStr), ret=parseDateLocal(returnStr); if(!dep||!ret) return "⏳ Dates not set"; const depMid=new Date(dep.getFullYear(),dep.getMonth(),dep.getDate()), retMid=new Date(ret.getFullYear(),ret.getMonth(),ret.getDate()), todayMid=today; if(todayMid<depMid) { const days=Math.ceil((depMid-todayMid)/86400000); return `🔜 ${days} day${days!==1?'s':''} until departure`; } if(todayMid.getTime()===depMid.getTime()) return "🏠 Departure today"; if(todayMid>depMid && todayMid<retMid) { const days=Math.ceil((retMid-todayMid)/86400000); return `🌴 On vacation (returns in ${days} day${days!==1?'s':''})`; } if(todayMid.getTime()===retMid.getTime()) return "📅 Return today – back to work tomorrow"; if(todayMid>retMid) { const days=Math.ceil((todayMid-retMid)/86400000); return `✅ Back at work (${days} day${days!==1?'s':''} ago)`; } return "⏳ Upcoming"; }
function getStatusFromDates(departureStr, returnStr, hasPdf) { if(hasPdf) return "Ticket Confirm"; if(!departureStr || !returnStr) return "Draft"; const today=getToday(), dep=parseDateLocal(departureStr), ret=parseDateLocal(returnStr); if(today>ret) return "Completed"; if(today>=dep && today<=ret) return "Ongoing"; if(today<dep) return "Upcoming"; return "Pending"; }
function recalcRowFields(row) { row.vacationDays = calculateVacationDays(row.departure, row.return); row.todayMessage = getTodayMessage(row.departure, row.return); row.ticketsTaken = parseInt(row.ticketsTaken) || 0; row.status = getStatusFromDates(row.departure, row.return, row.hasPdf); return row; }
function updateStatsUI() { const total=employeesData.length; let totalDays=0,totalTickets=0,confirmed=0; employeesData.forEach(e=>{ totalDays+=e.vacationDays||0; totalTickets+=e.ticketsTaken||0; if(e.hasPdf && e.status==="Ticket Confirm") confirmed++; }); document.getElementById('totalEmployeesStat').innerText=total; document.getElementById('totalVacationDaysStat').innerText=totalDays; document.getElementById('totalTicketsStat').innerText=totalTickets; document.getElementById('confirmedStat').innerText=confirmed; }
function escapeHtml(str) { if(!str) return ''; return str.replace(/[&<>]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }

function updateAnalytics() { 
    if(!sheetData.length) { 
        document.getElementById('analyticsTotalEmployees').innerText='0'; document.getElementById('analyticsTotalVacationDays').innerText='0'; document.getElementById('analyticsAvgVacationDays').innerText='0'; document.getElementById('analyticsUpcoming').innerText='0'; document.getElementById('analyticsOngoing').innerText='0'; document.getElementById('analyticsConfirmed').innerText='0'; 
        if(monthlyChart) monthlyChart.destroy(); if(statusChart) statusChart.destroy(); return; 
    } 
    const totalEmp=sheetData.length, totalVac=sheetData.reduce((s,e)=>s+(e.vacationDays||0),0), avgVac=totalEmp?(totalVac/totalEmp).toFixed(1):0; 
    const upcoming=sheetData.filter(e=>e.status==='Upcoming').length, ongoing=sheetData.filter(e=>e.status==='Ongoing').length, confirmed=sheetData.filter(e=>e.hasPdf && e.status==='Ticket Confirm').length; 
    document.getElementById('analyticsTotalEmployees').innerText=totalEmp; document.getElementById('analyticsTotalVacationDays').innerText=totalVac; document.getElementById('analyticsAvgVacationDays').innerText=avgVac; document.getElementById('analyticsUpcoming').innerText=upcoming; document.getElementById('analyticsOngoing').innerText=ongoing; document.getElementById('analyticsConfirmed').innerText=confirmed; 
    const monthMap=new Map(), monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; 
    sheetData.forEach(e=>{ if(e.departure){ const d=parseDateLocal(e.departure); if(d){ const m=d.getMonth(); monthMap.set(m,(monthMap.get(m)||0)+(e.vacationDays||0)); } } }); 
    const monthlyData=[]; for(let i=0;i<12;i++) monthlyData.push(monthMap.get(i)||0); 
    if(monthlyChart) monthlyChart.destroy(); 
    monthlyChart=new Chart(document.getElementById('monthlyChart'),{type:'bar',data:{labels:monthNames,datasets:[{label:'Total Vacation Days',data:monthlyData,backgroundColor:'#1e6f5c80',borderRadius:6}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{position:'top'}}}}); 
    const statusCounts={'Ticket Confirm':sheetData.filter(e=>e.status==='Ticket Confirm').length,'Upcoming':upcoming,'Ongoing':ongoing,'Completed':sheetData.filter(e=>e.status==='Completed').length,'Pending':sheetData.filter(e=>e.status==='Pending').length,'Draft':sheetData.filter(e=>e.status==='Draft').length}; 
    if(statusChart) statusChart.destroy(); 
    statusChart=new Chart(document.getElementById('statusChart'),{type:'pie',data:{labels:Object.keys(statusCounts),datasets:[{data:Object.values(statusCounts),backgroundColor:['#2e7d64','#ffc107','#17a2b8','#28a745','#fd7e14','#6c757d']}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{position:'right'}}}}); 
}

async function saveToGoogleSheet(dataToSave) { 
    try { 
        const payload = dataToSave.map(e=>({employeeName:e.employeeName,remarks:e.remarks,departure:e.departure,return:e.return,totalDay:e.vacationDays,ticketsTaken:e.ticketsTaken,hasPdf:e.hasPdf,pdfName:e.pdfName,pdfBase64:e.pdfBase64,status:e.status})); 
        await fetch(GOOGLE_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); 
        return true; 
    } catch(err){ console.error(err); return false; } 
}

// Monthly Summary
function showMonthlySummary() { document.getElementById('monthlySummaryModal').style.display = 'block'; }
function closeSummaryModal() { document.getElementById('monthlySummaryModal').style.display = 'none'; }
function loadMonthlySummary() {
    const year = parseInt(document.getElementById('summaryYear').value);
    const month = parseInt(document.getElementById('summaryMonth').value);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const departingEmployees = [], returningEmployees = [];
    sheetData.forEach(emp => {
        if (emp.departure) { const depDate = parseDateLocal(emp.departure); if (depDate && depDate.getFullYear() === year && depDate.getMonth() === month) departingEmployees.push(emp); }
        if (emp.return) { const retDate = parseDateLocal(emp.return); if (retDate && retDate.getFullYear() === year && retDate.getMonth() === month) returningEmployees.push(emp); }
    });
    const resultDiv = document.getElementById('summaryResult');
    if (departingEmployees.length === 0 && returningEmployees.length === 0) {
        resultDiv.innerHTML = `<div class="summary-card" style="background: linear-gradient(135deg, #6c757d, #495057);"><h3><i class="fas fa-calendar-alt"></i> ${monthNames[month]} ${year}</h3><div style="text-align: center; padding: 20px;"><i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 15px;"></i><p>No employees traveling or returning in this month.</p></div></div>`;
        return;
    }
    let html = `<div class="summary-card"><h3><i class="fas fa-calendar-alt"></i> ${monthNames[month]} ${year}</h3><div class="summary-stats"><div class="summary-stat"><div class="summary-stat-number">${departingEmployees.length}</div><div class="summary-stat-label"><i class="fas fa-plane-departure"></i> Going/Departing</div></div><div class="summary-stat"><div class="summary-stat-number">${returningEmployees.length}</div><div class="summary-stat-label"><i class="fas fa-plane-arrival"></i> Returning</div></div></div></div>`;
    if (departingEmployees.length > 0) {
        html += `<div class="employee-list"><h4><i class="fas fa-plane-departure" style="color: #1e6f5c;"></i> Employees Going/Departing (${departingEmployees.length})</h4><div class="employee-tags">`;
        departingEmployees.forEach(emp => { const depDate = emp.departure ? new Date(emp.departure).toLocaleDateString() : 'Date not set'; html += `<div class="employee-tag">✈️ ${escapeHtml(emp.employeeName)} <span style="font-size: 0.6rem;">(${depDate})</span></div>`; });
        html += `</div></div>`;
    }
    if (returningEmployees.length > 0) {
        html += `<div class="employee-list"><h4><i class="fas fa-plane-arrival" style="color: #17a2b8;"></i> Employees Returning (${returningEmployees.length})</h4><div class="employee-tags">`;
        returningEmployees.forEach(emp => { const retDate = emp.return ? new Date(emp.return).toLocaleDateString() : 'Date not set'; html += `<div class="employee-tag employee-tag-return">🛬 ${escapeHtml(emp.employeeName)} <span style="font-size: 0.6rem;">(${retDate})</span></div>`; });
        html += `</div></div>`;
    }
    resultDiv.innerHTML = html;
}

// Add Record Functions
function updateTempPreview(rowId) {
    const row = document.getElementById(`tempRow${rowId}`);
    if(!row) return;
    const dep = row.querySelector('.temp-emp-departure')?.value || '';
    const ret = row.querySelector('.temp-emp-return')?.value || '';
    const hasPdf = !!tempPdfData[rowId];
    const vacDays = calculateVacationDays(dep, ret);
    const status = getStatusFromDates(dep, ret, hasPdf);
    const message = getTodayMessage(dep, ret);
    document.getElementById(`tempVacation_${rowId}`).innerText = vacDays;
    const statusSpan = document.getElementById(`tempStatus_${rowId}`);
    statusSpan.innerText = status;
    statusSpan.className = 'status-badge';
    if(status === 'Ticket Confirm') statusSpan.classList.add('status-confirmed');
    else if(status === 'Upcoming') statusSpan.classList.add('status-upcoming');
    else if(status === 'Ongoing') statusSpan.classList.add('status-pending');
    else if(status === 'Completed') statusSpan.classList.add('status-completed');
    else statusSpan.classList.add('status-draft');
    document.getElementById(`tempMessage_${rowId}`).innerText = message;
}

function uploadTempPdf(rowId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if(file && file.type === 'application/pdf') {
            const reader = new FileReader();
            reader.onload = (ev) => {
                tempPdfData[rowId] = { base64: ev.target.result, name: file.name };
                const pdfNameSpan = document.querySelector(`#tempRow${rowId} .temp-pdf-name`);
                if(pdfNameSpan) pdfNameSpan.innerText = file.name.substring(0,12);
                updateTempPreview(rowId);
            };
            reader.readAsDataURL(file);
        } else alert('Please select a PDF file');
    };
    input.click();
}

function addTempRow() {
    const newId = ++tempRowCounter;
    const tbody = document.getElementById('addRecordsTableBody');
    const newRow = document.createElement('tr');
    newRow.id = `tempRow${newId}`;
    newRow.innerHTML = `<td style="font-weight:bold; background:#f8f9fa;">${tbody.children.length+1}<\/td>
        <td><input type="text" class="temp-emp-name" placeholder="Employee name" style="width:100%;"><\/td>
        <td><input type="text" class="temp-emp-remarks" placeholder="Remarks" style="width:100%;"><\/td>
        <td><input type="date" class="temp-emp-departure" style="width:100%;" onchange="updateTempPreview(${newId})"><\/td>
        <td><input type="date" class="temp-emp-return" style="width:100%;" onchange="updateTempPreview(${newId})"><\/td>
        <td><input type="number" class="temp-emp-tickets" value="0" min="0" style="width:70px;" onchange="updateTempPreview(${newId})"><\/td>
        <td><button class="pdf-upload-btn-small" onclick="uploadTempPdf(${newId})">📄 Upload PDF<\/button><div class="temp-pdf-name" style="font-size:9px; margin-top:3px;"><\/div><\/td>
        <td class="calc-vacation" id="tempVacation_${newId}">0<\/td>
        <td id="tempStatus_${newId}" class="status-badge status-draft">Draft<\/td>
        <td class="temp-preview-message" id="tempMessage_${newId}">-<\/td>
        <td><button class="action-btn delete-btn" onclick="removeTempRow(${newId})" style="background:#dc3545;">🗑️<\/button><\/td>`;
    tbody.appendChild(newRow);
    updateTempRowNumbers();
}

function updateTempRowNumbers() {
    const rows = document.querySelectorAll('#addRecordsTableBody tr');
    rows.forEach((row, idx) => { row.cells[0].innerText = idx+1; });
}

window.removeTempRow = function(id) {
    const tbody = document.getElementById('addRecordsTableBody');
    if(tbody.children.length <= 1) { alert('At least one row required'); return; }
    const row = document.getElementById(`tempRow${id}`);
    if(row) row.remove();
    delete tempPdfData[id];
    updateTempRowNumbers();
};

async function saveAllTempRecords() {
    const rows = document.querySelectorAll('#addRecordsTableBody tr');
    const newRecords = [];
    for(let i=0; i<rows.length; i++) {
        const row = rows[i];
        const nameInput = row.querySelector('.temp-emp-name');
        if(!nameInput || !nameInput.value.trim()) continue;
        const rowId = parseInt(row.id.replace('tempRow',''));
        const record = {
            employeeName: nameInput.value.trim(),
            remarks: row.querySelector('.temp-emp-remarks')?.value || '',
            departure: row.querySelector('.temp-emp-departure')?.value || '',
            return: row.querySelector('.temp-emp-return')?.value || '',
            ticketsTaken: parseInt(row.querySelector('.temp-emp-tickets')?.value) || 0,
            hasPdf: !!tempPdfData[rowId],
            pdfName: tempPdfData[rowId]?.name || '',
            pdfBase64: tempPdfData[rowId]?.base64 || '',
        };
        newRecords.push(record);
    }
    if(newRecords.length === 0) { alert('Please add at least one employee with name'); return; }
    const processed = newRecords.map(r => recalcRowFields(r));
    const allRecords = [...employeesData, ...processed];
    const success = await saveToGoogleSheet(allRecords);
    if(success) {
        employeesData = allRecords;
        sheetData = [...employeesData];
        updateAnalytics();
        updateStatsUI();
        closeAddModal();
        alert(`✅ Successfully added ${newRecords.length} employee(s) and saved to Google Sheet!`);
        await loadFromGoogleSheet();
    } else alert('❌ Error saving to Google Sheet');
    tempPdfData = {};
}

function openAddRecordModal() { 
    if(!isAdmin()){ alert('Only admin can add records.'); return; } 
    tempPdfData = {}; 
    const firstRow = document.getElementById('tempRow0');
    if(firstRow) {
        firstRow.querySelector('.temp-emp-name').value = '';
        firstRow.querySelector('.temp-emp-remarks').value = '';
        firstRow.querySelector('.temp-emp-departure').value = '';
        firstRow.querySelector('.temp-emp-return').value = '';
        firstRow.querySelector('.temp-emp-tickets').value = '0';
        firstRow.querySelector('.temp-pdf-name').innerText = '';
        updateTempPreview(0);
    }
    const tbody = document.getElementById('addRecordsTableBody');
    while(tbody.children.length > 1) { tbody.removeChild(tbody.children[1]); }
    tempRowCounter = 0;
    document.getElementById('addRecordModal').style.display = 'block'; 
}
function closeAddModal() { document.getElementById('addRecordModal').style.display = 'none'; }

// View Data Functions
function renderModalTable() { 
    const tbody=document.getElementById('modalTableBody'); 
    const admin=isAdmin(); 
    if(!sheetData.length){ tbody.innerHTML='<tr><td colspan="11" style="text-align:center; padding:50px;">No records. Click "Refresh Data" first.</td></tr>'; return; } 
    let html=''; 
    sheetData.forEach((emp,idx)=>{ 
        const isEditing=(admin && editingModalRowId===idx); 
        const fresh=recalcRowFields({...emp}); 
        sheetData[idx]=fresh; 
        let statusClass='status-pending'; 
        if(fresh.status==='Ticket Confirm') statusClass='status-confirmed'; 
        else if(fresh.status==='Completed') statusClass='status-completed'; 
        else if(fresh.status==='Upcoming') statusClass='status-upcoming'; 
        const depFmt=formatDateToYMD(fresh.departure), retFmt=formatDateToYMD(fresh.return); 
        if(isEditing){ 
            let pdfSection=`<button class="action-btn upload-pdf-btn" onclick="uploadModalPdf(${idx})">📄 ${fresh.hasPdf?'Change PDF':'Upload'}<\/button>`; 
            if(fresh.hasPdf){ pdfSection+=`<button class="action-btn delete-pdf-btn" onclick="deleteModalPdf(${idx})" style="background:#dc3545; color:white; margin-left:5px;">❌ Remove<\/button><div class="pdf-name-display">${fresh.pdfName?.substring(0,10)||''}<\/div>`; } 
            html+=`<tr style="background:#fff3cd;"><td>${idx+1}<\/td><td><input type="text" id="modal_edit_name_${idx}" value="${escapeHtml(fresh.employeeName)}" style="width:110px"><\/td><td><input type="text" id="modal_edit_remarks_${idx}" value="${escapeHtml(fresh.remarks)}" style="width:110px"><\/td><td><input type="date" id="modal_edit_departure_${idx}" value="${depFmt}"><\/td><td><input type="date" id="modal_edit_return_${idx}" value="${retFmt}"><\/td><td>${fresh.vacationDays}<\/td><td><input type="number" id="modal_edit_tickets_${idx}" value="${fresh.ticketsTaken}" min="0" style="width:60px"><\/td><td>${pdfSection}<\/td><td><span class="${statusClass}">${fresh.status}<\/span><\/td><td class="today-message-cell">${escapeHtml(fresh.todayMessage)}<\/td><td class="modal-actions"><button class="action-btn save-edit-btn" onclick="saveModalEdit(${idx})">💾 Save<\/button><button class="action-btn cancel-edit-btn" onclick="cancelModalEdit()">❌ Cancel<\/button><\/td><\/tr>`; 
        } else { 
            let pdfHtml=fresh.hasPdf?`<span style="color:#2e7d64;">✓ PDF<\/span><br><span style="font-size:9px;">${fresh.pdfName?.substring(0,8)||''}<\/span>`:'-'; 
            html+=`<tr><td>${idx+1}<\/td><td>${escapeHtml(fresh.employeeName||'-')}<\/td><td>${escapeHtml(fresh.remarks||'-')}<\/td><td>${fresh.departure||'-'}<\/td><td>${fresh.return||'-'}<\/td><td>${fresh.vacationDays}<\/td><td>${fresh.ticketsTaken}<\/td><td>${pdfHtml}<\/td><td><span class="${statusClass}">${fresh.status}<\/span><\/td><td class="today-message-cell">${escapeHtml(fresh.todayMessage)}<\/td><td class="modal-actions">${admin?`<button class="action-btn edit-btn" onclick="startModalEdit(${idx})">✏️ Edit<\/button>`:''}${admin && fresh.hasPdf?`<button class="action-btn view-pdf-btn" onclick="viewModalPdfLarge(${idx})">👁️ View PDF<\/button>`:''}${admin?`<button class="action-btn delete-btn" onclick="deleteModalRecord(${idx})">🗑️ Delete<\/button>`:''}<\/td><\/tr>`; 
        } 
    }); 
    tbody.innerHTML=html; 
}

window.startModalEdit=function(id){ if(isAdmin()){ editingModalRowId=id; renderModalTable(); } };
window.cancelModalEdit=function(){ editingModalRowId=null; renderModalTable(); };
window.saveModalEdit=async function(id){ if(!isAdmin()) return; sheetData[id]={...sheetData[id], employeeName:document.getElementById(`modal_edit_name_${id}`)?.value||'', remarks:document.getElementById(`modal_edit_remarks_${id}`)?.value||'', departure:document.getElementById(`modal_edit_departure_${id}`)?.value||'', return:document.getElementById(`modal_edit_return_${id}`)?.value||'', ticketsTaken:parseInt(document.getElementById(`modal_edit_tickets_${id}`)?.value)||0 }; sheetData[id]=recalcRowFields(sheetData[id]); editingModalRowId=null; renderModalTable(); employeesData=[...sheetData]; updateAnalytics(); updateStatsUI(); await saveToGoogleSheet(sheetData); showModalMessage('Record updated!','success'); };
window.deleteModalRecord=function(id){ if(!isAdmin()) return; if(confirm('Delete permanently?')){ sheetData.splice(id,1); employeesData=[...sheetData]; renderModalTable(); updateAnalytics(); updateStatsUI(); saveToGoogleSheet(sheetData); showModalMessage('Record deleted','success'); } };
window.deleteModalPdf=function(id){ if(!isAdmin()) return; if(confirm('Remove PDF?')){ sheetData[id].hasPdf=false; sheetData[id].pdfName=''; sheetData[id].pdfBase64=''; sheetData[id]=recalcRowFields(sheetData[id]); employeesData=[...sheetData]; renderModalTable(); updateAnalytics(); updateStatsUI(); saveToGoogleSheet(sheetData); showModalMessage('PDF removed','success'); } };
window.uploadModalPdf=function(id){ if(isAdmin()){ currentModalPdfIndex=id; document.getElementById('modalPdfUploadInput').click(); } };
window.viewModalPdfLarge=function(id){ const emp=sheetData[id]; if(emp?.pdfBase64) showLargePdf(emp.pdfBase64,emp.pdfName,emp.employeeName); else alert('No PDF'); };

document.getElementById('modalPdfUploadInput').onchange=async function(e){ if(!isAdmin()) return; const file=e.target.files[0]; if(!file || currentModalPdfIndex===null) return; if(file.type!=='application/pdf'){ alert('PDF only'); return; } const reader=new FileReader(); reader.onload=async (ev)=>{ if(currentModalPdfIndex<sheetData.length){ sheetData[currentModalPdfIndex].hasPdf=true; sheetData[currentModalPdfIndex].pdfName=file.name; sheetData[currentModalPdfIndex].pdfBase64=ev.target.result; sheetData[currentModalPdfIndex]=recalcRowFields(sheetData[currentModalPdfIndex]); employeesData=[...sheetData]; renderModalTable(); updateAnalytics(); updateStatsUI(); await saveToGoogleSheet(sheetData); showModalMessage('PDF uploaded!','success'); } currentModalPdfIndex=null; }; reader.readAsDataURL(file); this.value=''; };

function showModalMessage(msg,type){ const div=document.getElementById('modalMessage'); div.style.display='block'; div.style.background=type==='success'?'#d4edda':'#f8d7da'; div.style.color=type==='success'?'#155724':'#721c24'; div.style.border=type==='success'?'1px solid #c3e6cb':'1px solid #f5c6cb'; div.innerHTML=msg; setTimeout(()=>div.style.display='none',3000); }
function openModal(){ document.getElementById('sheetModal').style.display='block'; }
function closeModal(){ document.getElementById('sheetModal').style.display='none'; editingModalRowId=null; }
function showLargePdf(pdfData,fileName,employeeName){ const modal=document.getElementById('pdfViewerModal'); document.getElementById('pdfViewerTitle').innerHTML=`<i class="fas fa-file-pdf"></i> ${escapeHtml(employeeName)} - Ticket PDF`; document.getElementById('pdfFileNameDisplay').innerHTML=`<i class="fas fa-ticket-alt"></i> ${escapeHtml(fileName)}`; document.getElementById('pdfViewerFrame').src=pdfData; modal.style.display='block'; }
function closeLargePdf(){ document.getElementById('pdfViewerModal').style.display='none'; document.getElementById('pdfViewerFrame').src=''; }
function viewLoadedData(){ if(sheetData.length){ renderModalTable(); openModal(); } else { alert('No data loaded. Click "Refresh Data" first.'); } }

// Google Sheet Functions
async function loadFromGoogleSheet(){ 
    updateSyncLabel('Loading...'); 
    try{ 
        const res=await fetch(GOOGLE_URL); 
        const data=await res.json(); 
        if(Array.isArray(data)){ 
            if(data.length===0){ updateSyncLabel('No records',true); sheetData=[]; employeesData=[]; } 
            else { 
                sheetData=data.map(row=>recalcRowFields({ employeeName:row.employeeName||row.Employee||'', remarks:row.remarks||row.Remarks||'', departure:row.departure?formatDateToYMD(row.departure):'', return:row.return?formatDateToYMD(row.return):'', ticketsTaken:row.ticketsTaken||row.TicketsTaken||0, hasPdf:row.hasPdf||row.HasPDF==='TRUE'||false, pdfName:row.pdfName||row.PDFName||'', pdfBase64:row.pdfBase64||row.PDFBase64||'', status:row.status||row.Status||'' })); 
                employeesData=[...sheetData]; updateSyncLabel(`✅ Loaded ${sheetData.length} records`); 
            } 
            renderModalTable(); updateAnalytics(); updateStatsUI(); 
        } else throw new Error('Invalid response'); 
    } catch(err){ updateSyncLabel('❌ Failed',true); console.error(err); } 
}

async function saveModalToGoogleSheet(){ if(!isAdmin()) return; if(!sheetData.length){ showModalMessage('No data','error'); return; } updateSyncLabel('Saving...'); const success=await saveToGoogleSheet(sheetData); if(success){ updateSyncLabel('✓ Saved'); showModalMessage('Changes saved!','success'); employeesData=[...sheetData]; updateAnalytics(); updateStatsUI(); setTimeout(()=>closeModal(),1500); } else { updateSyncLabel('✗ Error',true); showModalMessage('Error saving','error'); } }
async function refreshAndLoad() { await loadFromGoogleSheet(); }
async function testConnection() { updateSyncLabel('Testing...'); try{ const res=await fetch(GOOGLE_URL); const data=await res.json(); alert(`✅ Connected! Found ${data.length} records.`); updateSyncLabel('✓ Connected'); } catch(e){ updateSyncLabel('❌ Failed',true); alert('Cannot connect.'); } }
function addNewRecord() { if(isAdmin()) openAddRecordModal(); }
function updateSyncLabel(text,isError=false){ const s=document.getElementById('syncStatusLabel'); if(s){ s.innerText=text; s.style.color=isError?'#ffb74d':'#28a745'; } }
function openGoogleSheetPopup(){ const modal=document.getElementById('googleSheetModal'); document.getElementById('googleSheetFrame').src=GOOGLE_SHEET_URL; modal.style.display='block'; }
function closeGoogleSheetPopup(){ const modal=document.getElementById('googleSheetModal'); document.getElementById('googleSheetFrame').src=''; modal.style.display='none'; }

// Auth & Init
function showAirplaneAndProceed() {
    if(animationPlayed) {
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('mainContainer').style.display = 'block';
        document.getElementById('mainFooter').style.display = 'block';
        applyUIRestrictions();
        initializeApp();
        startAutoRefresh();
        setTimeout(() => loadFromGoogleSheet(), 100);
        return;
    }
    animationPlayed = true;
    const animDiv = document.getElementById('airplaneAnimation');
    animDiv.style.display = 'flex';
    setTimeout(() => {
        animDiv.style.display = 'none';
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('mainContainer').style.display = 'block';
        document.getElementById('mainFooter').style.display = 'block';
        applyUIRestrictions();
        initializeApp();
        startAutoRefresh();
        setTimeout(() => loadFromGoogleSheet(), 100);
    }, 2000);
}

async function attemptLogin() { 
    const username = document.getElementById('username').value.trim().toLowerCase(), password = document.getElementById('password').value; 
    if(users[username] && users[username].password === password) { 
        currentUserRole = users[username].role; 
        currentUserName = users[username].name; 
        document.getElementById('loginError').style.display = 'none'; 
        document.getElementById('currentUser').innerText = currentUserName; 
        document.getElementById('currentRole').innerText = currentUserRole.toUpperCase(); 
        showAirplaneAndProceed();
    } else { 
        const errDiv = document.getElementById('loginError'); 
        errDiv.innerText = 'Invalid username or password!'; 
        errDiv.style.display = 'block'; 
    } 
}

function logout() { 
    if(autoRefreshInterval) clearInterval(autoRefreshInterval); 
    currentUserRole = null; currentUserName = null; 
    document.getElementById('mainContainer').style.display = 'none'; 
    document.getElementById('mainFooter').style.display = 'none'; 
    document.getElementById('loginModal').style.display = 'flex'; 
    closeModal(); closeAddModal(); closeGoogleSheetPopup(); closeLargePdf(); closeSummaryModal();
    animationPlayed = false;
}

function startAutoRefresh() { if(autoRefreshInterval) clearInterval(autoRefreshInterval); autoRefreshInterval = setInterval(() => loadFromGoogleSheet(), 30000); }
function applyUIRestrictions() { const admin = (currentUserRole === 'admin'); ['addNewRowBtn', 'saveModalChangesBtn'].forEach(btnId => { const btn = document.getElementById(btnId); if(btn) { if(!admin) { btn.classList.add('btn-disabled'); btn.disabled = true; } else { btn.classList.remove('btn-disabled'); btn.disabled = false; } } }); }
function isAdmin() { return currentUserRole === 'admin'; }

function initializeApp(){ 
    document.getElementById('addNewRowBtn').onclick=addNewRecord; 
    document.getElementById('refreshDataBtn').onclick=refreshAndLoad; 
    document.getElementById('viewLoadedDataBtn').onclick=viewLoadedData; 
    document.getElementById('openGoogleSheetBtn').onclick=openGoogleSheetPopup; 
    document.getElementById('testConnectionBtn').onclick=testConnection; 
    document.getElementById('monthlySummaryBtn').onclick=showMonthlySummary;
    document.getElementById('loadSummaryBtn').onclick=loadMonthlySummary;
    document.getElementById('saveModalChangesBtn').onclick=saveModalToGoogleSheet; 
    document.getElementById('closeModalBtn').onclick=closeModal; 
    document.getElementById('closeModalBtn2').onclick=closeModal; 
    document.getElementById('closePdfViewerModal').onclick=closeLargePdf; 
    document.getElementById('closeGoogleSheetModal').onclick=closeGoogleSheetPopup; 
    document.getElementById('closeAddModal').onclick=closeAddModal; 
    document.getElementById('closeSummaryModal').onclick=closeSummaryModal;
    document.getElementById('addRowModalBtn').onclick=addTempRow; 
    document.getElementById('saveAllModalBtn').onclick=saveAllTempRecords; 
    document.getElementById('cancelModalBtn').onclick=closeAddModal; 
    window.onclick=(e)=>{ 
        if(e.target===document.getElementById('pdfViewerModal')) closeLargePdf(); 
        if(e.target===document.getElementById('sheetModal')) closeModal(); 
        if(e.target===document.getElementById('googleSheetModal')) closeGoogleSheetPopup(); 
        if(e.target===document.getElementById('addRecordModal')) closeAddModal();
        if(e.target===document.getElementById('monthlySummaryModal')) closeSummaryModal();
    }; 
    sheetData=[]; employeesData=[]; updateSyncLabel('Ready'); 
    window.updateTempPreview = updateTempPreview; window.uploadTempPdf = uploadTempPdf; window.removeTempRow = removeTempRow; 
}

// Load saved theme on page load
loadSavedTheme();

window.addEventListener('load',()=>{ 
    document.getElementById('loginModal').style.display='flex'; 
    document.getElementById('mainContainer').style.display='none'; 
    document.getElementById('mainFooter').style.display='none'; 
});
