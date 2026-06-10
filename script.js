// ======================== USER AUTHENTICATION ========================
let currentUserRole = null;
let currentUserName = null;
const users = {
    admin: { password: "535680", role: "admin", name: "Administrator" },
    user: { password: "742744", role: "user", name: "Guest User" }
};

function attemptLogin() {
    const username = document.getElementById('username').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('loginError');
    if (users[username] && users[username].password === password) {
        currentUserRole = users[username].role;
        currentUserName = users[username].name;
        errorDiv.style.display = 'none';
        document.getElementById('loginModal').style.display = 'none';
        document.getElementById('mainContainer').style.display = 'block';
        document.getElementById('mainFooter').style.display = 'block';
        document.getElementById('currentUser').innerText = currentUserName;
        document.getElementById('currentRole').innerText = currentUserRole.toUpperCase();
        applyUIRestrictions();
        initializeApp();
    } else {
        errorDiv.innerText = 'Invalid username or password!';
        errorDiv.style.display = 'block';
    }
}

function logout() {
    currentUserRole = null;
    currentUserName = null;
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('mainFooter').style.display = 'none';
    document.getElementById('loginModal').style.display = 'flex';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
}

function applyUIRestrictions() {
    const isAdmin = (currentUserRole === 'admin');
    const adminButtons = ['addNewRowBtn', 'clearAllBtn', 'syncToGoogleBtn', 'saveModalChangesBtn'];
    if (!isAdmin) {
        adminButtons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) { btn.classList.add('btn-disabled'); btn.disabled = true; }
        });
    } else {
        adminButtons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) { btn.classList.remove('btn-disabled'); btn.disabled = false; }
        });
    }
}

function isAdmin() { return currentUserRole === 'admin'; }

// ======================== GOOGLE SCRIPT URL ========================
const EMBEDDED_GOOGLE_URL = "https://script.google.com/macros/s/AKfycbyOaEqHirF2nZhAT-jSwTvDSVLFvuwbhKRDaZNJpTsOG2-KrQXGYpwm-YLkTU0KNorh/exec";
let employeesData = [];
let sheetData = [];
let currentPdfIndex = null;
let currentModalPdfIndex = null;
let editingModalRowId = null;
let GOOGLE_URL = EMBEDDED_GOOGLE_URL;
let monthlyChart = null;
let statusChart = null;

// ========== HELPER FUNCTIONS ==========
function getToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function calculateVacationDays(departureStr, returnStr) {
    if (!departureStr || !returnStr) return 0;
    const start = new Date(departureStr), end = new Date(returnStr);
    if (isNaN(start) || isNaN(end)) return 0;
    return Math.ceil((end - start) / (86400000)) + 1;
}
function formatDateToYMD(dateValue) {
    if (!dateValue) return '';
    if (typeof dateValue === 'string' && dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) return dateValue;
    const date = new Date(dateValue);
    return isNaN(date) ? '' : date.toISOString().split('T')[0];
}

// Enhanced message: counts days until departure, days on vacation, and days since return
function getTodayMessage(departureStr, returnStr) {
    const today = getToday();
    const departure = departureStr ? new Date(departureStr) : null;
    const returnDate = returnStr ? new Date(returnStr) : null;
    if (!departure || !returnDate) return "⏳ Dates not set";
    const depMid = new Date(departure); depMid.setHours(0,0,0,0);
    const retMid = new Date(returnDate); retMid.setHours(0,0,0,0);
    const todayMid = today;
    if (todayMid < depMid) {
        const daysDiff = Math.ceil((depMid - todayMid) / 86400000);
        return `🔜 ${daysDiff} day${daysDiff !== 1 ? 's' : ''} until departure`;
    }
    if (todayMid.getTime() === depMid.getTime()) return "🏠 Departure today";
    if (todayMid > depMid && todayMid < retMid) {
        const daysToReturn = Math.ceil((retMid - todayMid) / 86400000);
        return `🌴 On vacation (returns in ${daysToReturn} day${daysToReturn !== 1 ? 's' : ''})`;
    }
    if (todayMid.getTime() === retMid.getTime()) return "📅 Return today – back to work tomorrow";
    if (todayMid > retMid) {
        const daysBack = Math.ceil((todayMid - retMid) / 86400000);
        return `✅ Back at work (${daysBack} day${daysBack !== 1 ? 's' : ''} ago)`;
    }
    return "⏳ Upcoming";
}

function recalcRowFields(row) {
    row.vacationDays = calculateVacationDays(row.departure, row.return);
    row.todayMessage = getTodayMessage(row.departure, row.return);
    row.ticketsTaken = parseInt(row.ticketsTaken) || 0;
    if (row.hasPdf && row.pdfName) row.status = "Ticket Confirm";
    else if (row.departure && row.return) {
        const today = getToday(), dep = new Date(row.departure), ret = new Date(row.return);
        if (today > ret) row.status = "Completed";
        else if (today >= dep && today <= ret) row.status = "Ongoing";
        else if (today < dep) row.status = "Upcoming";
        else row.status = "Pending";
    } else row.status = "Draft";
    return row;
}

function updateStatsUI() {
    const total = employeesData.length;
    let totalDays = 0, totalTickets = 0, confirmed = 0;
    employeesData.forEach(e => {
        totalDays += e.vacationDays || 0;
        totalTickets += e.ticketsTaken || 0;
        if (e.hasPdf && e.status === "Ticket Confirm") confirmed++;
    });
    document.getElementById('totalEmployeesStat').innerText = total;
    document.getElementById('totalVacationDaysStat').innerText = totalDays;
    document.getElementById('totalTicketsStat').innerText = totalTickets;
    document.getElementById('confirmedStat').innerText = confirmed;
}

function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[m])); }

// ========== ANALYTICS & CHARTS ==========
function updateAnalytics() {
    if (!sheetData.length) {
        document.getElementById('analyticsTotalEmployees').innerText = '0';
        document.getElementById('analyticsTotalVacationDays').innerText = '0';
        document.getElementById('analyticsAvgVacationDays').innerText = '0';
        document.getElementById('analyticsUpcoming').innerText = '0';
        document.getElementById('analyticsOngoing').innerText = '0';
        document.getElementById('analyticsConfirmed').innerText = '0';
        if (monthlyChart) monthlyChart.destroy();
        if (statusChart) statusChart.destroy();
        return;
    }
    const totalEmp = sheetData.length;
    const totalVac = sheetData.reduce((s,e) => s + (e.vacationDays||0), 0);
    const avgVac = totalEmp ? (totalVac / totalEmp).toFixed(1) : 0;
    const upcoming = sheetData.filter(e => e.status === 'Upcoming').length;
    const ongoing = sheetData.filter(e => e.status === 'Ongoing').length;
    const confirmed = sheetData.filter(e => e.hasPdf && e.status === 'Ticket Confirm').length;
    document.getElementById('analyticsTotalEmployees').innerText = totalEmp;
    document.getElementById('analyticsTotalVacationDays').innerText = totalVac;
    document.getElementById('analyticsAvgVacationDays').innerText = avgVac;
    document.getElementById('analyticsUpcoming').innerText = upcoming;
    document.getElementById('analyticsOngoing').innerText = ongoing;
    document.getElementById('analyticsConfirmed').innerText = confirmed;

    const monthMap = new Map();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    sheetData.forEach(e => {
        if (e.departure) {
            const d = new Date(e.departure);
            if (!isNaN(d)) {
                const m = d.getMonth();
                monthMap.set(m, (monthMap.get(m)||0) + (e.vacationDays||0));
            }
        }
    });
    const monthlyData = [];
    for (let i=0;i<12;i++) monthlyData.push(monthMap.get(i)||0);
    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = new Chart(document.getElementById('monthlyChart'), {
        type: 'bar',
        data: { labels: monthNames, datasets: [{ label: 'Total Vacation Days', data: monthlyData, backgroundColor: '#1e6f5c80', borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'top' } } }
    });
    const statusCounts = {
        'Ticket Confirm': sheetData.filter(e => e.status === 'Ticket Confirm').length,
        'Upcoming': upcoming, 'Ongoing': ongoing,
        'Completed': sheetData.filter(e => e.status === 'Completed').length,
        'Pending': sheetData.filter(e => e.status === 'Pending').length,
        'Draft': sheetData.filter(e => e.status === 'Draft').length
    };
    if (statusChart) statusChart.destroy();
    statusChart = new Chart(document.getElementById('statusChart'), {
        type: 'pie',
        data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts), backgroundColor: ['#2e7d64','#ffc107','#17a2b8','#28a745','#fd7e14','#6c757d'] }] },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'right' } } }
    });
}

// ========== MAIN TABLE RENDER ==========
function renderMainTable() {
    const tbody = document.getElementById('tableBody');
    const admin = isAdmin();
    if (!employeesData.length) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:2.5rem;">Click "Add New Record" to add employee</td}</tr>`;
        updateStatsUI();
        return;
    }
    let html = '';
    employeesData.forEach((emp, idx) => {
        const fresh = recalcRowFields({ ...emp });
        employeesData[idx] = fresh;
        let statusClass = 'status-pending';
        if (fresh.status === 'Ticket Confirm') statusClass = 'status-confirmed';
        else if (fresh.status === 'Completed') statusClass = 'status-completed';
        else if (fresh.status === 'Upcoming') statusClass = 'status-upcoming';
        const pdfBtnClass = fresh.hasPdf ? 'pdf-btn pdf-uploaded' : 'pdf-btn';
        const pdfBtnText = fresh.hasPdf ? '✓ PDF' : 'Upload';
        const depFmt = formatDateToYMD(fresh.departure), retFmt = formatDateToYMD(fresh.return);
        html += `<tr data-idx="${idx}"><td>${idx+1}</td>`;
        if (admin) {
            html += `<td><input type="text" class="emp-name" value="${escapeHtml(fresh.employeeName)}" placeholder="Name" data-idx="${idx}" style="width:140px"></td>
                     <td><input type="text" class="emp-remarks" value="${escapeHtml(fresh.remarks)}" placeholder="Remarks" data-idx="${idx}" style="width:150px"></td>
                     <td><input type="date" class="emp-departure" value="${depFmt}" data-idx="${idx}"></td>
                     <td><input type="date" class="emp-return" value="${retFmt}" data-idx="${idx}"></td>`;
        } else {
            html += `<td class="readonly-cell">${escapeHtml(fresh.employeeName||'-')}</td>
                     <td class="readonly-cell">${escapeHtml(fresh.remarks||'-')}</td>
                     <td class="readonly-cell">${fresh.departure||'-'}</td>
                     <td class="readonly-cell">${fresh.return||'-'}</td>`;
        }
        html += `<td class="vacation-cell">${fresh.vacationDays}</td>`;
        if (admin) {
            html += `<td><input type="number" class="emp-tickets" value="${fresh.ticketsTaken}" min="0" style="width:70px" data-idx="${idx}"></td>`;
        } else {
            html += `<td class="readonly-cell">${fresh.ticketsTaken}</td>`;
        }
        html += `<td>
                    ${admin ? `<button class="${pdfBtnClass}" data-idx="${idx}">${pdfBtnText}</button>` : (fresh.hasPdf ? '<span style="color:#2e7d64;">✓ PDF</span>' : '-')}
                    ${fresh.pdfName && admin ? `<div class="pdf-name-display">${fresh.pdfName.substring(0,12)}</div>` : ''}
                  </td>
                  <td><span class="${statusClass}">${fresh.status}</span></td>
                  <td class="today-message-cell">${escapeHtml(fresh.todayMessage)}</td>
                  <td class="action-buttons">${admin ? `<button class="action-btn delete-btn" onclick="deleteNewRecord(${idx})">🗑️ Delete</button>` : ''}</td>
                </tr>`;
    });
    tbody.innerHTML = html;
    if (admin) attachMainEvents();
    updateStatsUI();
}

function attachMainEvents() {
    if (!isAdmin()) return;
    document.querySelectorAll('.pdf-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const idx = parseInt(btn.dataset.idx);
            if (!isNaN(idx)) { currentPdfIndex = idx; document.getElementById('pdfUploadInput').click(); }
        };
    });
    const inputs = document.querySelectorAll('.emp-name, .emp-remarks, .emp-departure, .emp-return, .emp-tickets');
    inputs.forEach(inp => {
        inp.onchange = () => updateMainRowCalculation(parseInt(inp.dataset.idx));
        inp.oninput = () => updateMainRowCalculation(parseInt(inp.dataset.idx));
        inp.onblur = () => updateMainRowCalculation(parseInt(inp.dataset.idx));
    });
}

function updateMainRowCalculation(idx) {
    if (!isAdmin()) return;
    const row = document.querySelector(`tr[data-idx="${idx}"]`);
    if (!row) return;
    employeesData[idx].employeeName = row.querySelector('.emp-name')?.value || '';
    employeesData[idx].remarks = row.querySelector('.emp-remarks')?.value || '';
    employeesData[idx].departure = row.querySelector('.emp-departure')?.value || '';
    employeesData[idx].return = row.querySelector('.emp-return')?.value || '';
    employeesData[idx].ticketsTaken = parseInt(row.querySelector('.emp-tickets')?.value) || 0;
    employeesData[idx] = recalcRowFields(employeesData[idx]);
    const vacationCell = row.querySelector('.vacation-cell');
    if (vacationCell) vacationCell.innerText = employeesData[idx].vacationDays;
    const statusSpan = row.querySelector('td:nth-child(8) span');
    if (statusSpan) {
        let cls = 'status-pending';
        if (employeesData[idx].status === 'Ticket Confirm') cls = 'status-confirmed';
        else if (employeesData[idx].status === 'Completed') cls = 'status-completed';
        else if (employeesData[idx].status === 'Upcoming') cls = 'status-upcoming';
        statusSpan.className = cls;
        statusSpan.innerText = employeesData[idx].status;
    }
    const todayMsgCell = row.querySelector('.today-message-cell');
    if (todayMsgCell) todayMsgCell.innerText = employeesData[idx].todayMessage;
    updateStatsUI();
}

document.getElementById('pdfUploadInput').onchange = function(e) {
    if (!isAdmin()) return;
    const file = e.target.files[0];
    if (!file || currentPdfIndex === null) return;
    if (file.type !== 'application/pdf') { alert('PDF only'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
        if (currentPdfIndex < employeesData.length) {
            employeesData[currentPdfIndex].hasPdf = true;
            employeesData[currentPdfIndex].pdfName = file.name;
            employeesData[currentPdfIndex].pdfBase64 = ev.target.result;
            employeesData[currentPdfIndex] = recalcRowFields(employeesData[currentPdfIndex]);
            renderMainTable();
        }
        currentPdfIndex = null;
    };
    reader.readAsDataURL(file);
    this.value = '';
};
function deleteNewRecord(id) { if (isAdmin() && confirm('Delete this new record?')) { employeesData.splice(id,1); renderMainTable(); } }

// ========== LARGE PDF VIEWER ==========
function showLargePdf(pdfData, fileName, employeeName) {
    const modal = document.getElementById('pdfViewerModal');
    document.getElementById('pdfViewerTitle').innerHTML = `<i class="fas fa-file-pdf"></i> ${escapeHtml(employeeName)} - Ticket PDF`;
    document.getElementById('pdfFileNameDisplay').innerHTML = `<i class="fas fa-ticket-alt"></i> ${escapeHtml(fileName)}`;
    document.getElementById('pdfViewerFrame').src = pdfData;
    modal.style.display = 'block';
}
function closeLargePdf() {
    document.getElementById('pdfViewerModal').style.display = 'none';
    document.getElementById('pdfViewerFrame').src = '';
}

// ========== MODAL FUNCTIONS ==========
function renderModalTable() {
    const tbody = document.getElementById('modalTableBody');
    const admin = isAdmin();
    if (!sheetData.length) { tbody.innerHTML = '<tr><td colspan="11" style="padding:40px;">No records. Click "Refresh & Load" first.<?td></tr>'; return; }
    let html = '';
    sheetData.forEach((emp, idx) => {
        const isEditing = (admin && editingModalRowId === idx);
        const fresh = recalcRowFields({ ...emp });
        sheetData[idx] = fresh;
        let statusClass = 'status-pending';
        if (fresh.status === 'Ticket Confirm') statusClass = 'status-confirmed';
        else if (fresh.status === 'Completed') statusClass = 'status-completed';
        else if (fresh.status === 'Upcoming') statusClass = 'status-upcoming';
        const depFmt = formatDateToYMD(fresh.departure), retFmt = formatDateToYMD(fresh.return);
        if (isEditing) {
            let pdfSection = `<button class="action-btn upload-pdf-btn" onclick="uploadModalPdf(${idx})">📄 ${fresh.hasPdf ? 'Change PDF' : 'Upload'}</button>`;
            if (fresh.hasPdf) {
                pdfSection += `<button class="action-btn delete-pdf-btn" onclick="deleteModalPdf(${idx})" style="background:#dc3545; color:white; margin-left:5px;">❌ Remove PDF</button>`;
                pdfSection += `<div class="pdf-name-display">${fresh.pdfName.substring(0,10)}</div>`;
            }
            html += `<tr style="background:#fff3cd;">
                        <td>${idx+1}</td>
                        <td><input type="text" id="modal_edit_name_${idx}" value="${escapeHtml(fresh.employeeName)}" style="width:120px"></td>
                        <td><input type="text" id="modal_edit_remarks_${idx}" value="${escapeHtml(fresh.remarks)}" style="width:120px"></td>
                        <td><input type="date" id="modal_edit_departure_${idx}" value="${depFmt}"></td>
                        <td><input type="date" id="modal_edit_return_${idx}" value="${retFmt}"></td>
                        <td>${fresh.vacationDays}</td>
                        <td><input type="number" id="modal_edit_tickets_${idx}" value="${fresh.ticketsTaken}" min="0" style="width:60px"></td>
                        <td>${pdfSection}</td>
                        <td><span class="${statusClass}">${fresh.status}</span></td>
                        <td class="today-message-cell">${escapeHtml(fresh.todayMessage)}</td>
                        <td class="modal-actions">
                            <button class="action-btn save-edit-btn" onclick="saveModalEdit(${idx})">💾 Save</button>
                            <button class="action-btn cancel-edit-btn" onclick="cancelModalEdit()">❌ Cancel</button>
                        </td>
                      </td>`;
        } else {
            let pdfHtml = fresh.hasPdf ? `<span style="color:#2e7d64;">✓ PDF</span><br><span style="font-size:9px;">${fresh.pdfName.substring(0,10)}</span>` : '-';
            html += `<tr>
                        <td>${idx+1}</td>
                        <td>${escapeHtml(fresh.employeeName||'-')}</td>
                        <td>${escapeHtml(fresh.remarks||'-')}</td>
                        <td>${fresh.departure||'-'}</td>
                        <td>${fresh.return||'-'}</td>
                        <td>${fresh.vacationDays}</td>
                        <td>${fresh.ticketsTaken}</td>
                        <td>${pdfHtml}</td>
                        <td><span class="${statusClass}">${fresh.status}</span></td>
                        <td class="today-message-cell">${escapeHtml(fresh.todayMessage)}</td>
                        <td class="modal-actions">
                            ${admin ? `<button class="action-btn edit-btn" onclick="startModalEdit(${idx})">✏️ Edit</button>` : ''}
                            ${fresh.hasPdf ? `<button class="action-btn view-pdf-btn" onclick="viewModalPdfLarge(${idx})">👁️ View PDF</button>` : ''}
                            ${admin ? `<button class="action-btn delete-btn" onclick="deleteModalRecord(${idx})">🗑️ Delete Record</button>` : ''}
                        </td>
                      </tr>`;
        }
    });
    tbody.innerHTML = html;
}
function startModalEdit(id) { if (isAdmin()) { editingModalRowId = id; renderModalTable(); } }
function cancelModalEdit() { editingModalRowId = null; renderModalTable(); }
function saveModalEdit(id) {
    if (!isAdmin()) return;
    sheetData[id] = {
        ...sheetData[id],
        employeeName: document.getElementById(`modal_edit_name_${id}`)?.value || '',
        remarks: document.getElementById(`modal_edit_remarks_${id}`)?.value || '',
        departure: document.getElementById(`modal_edit_departure_${id}`)?.value || '',
        return: document.getElementById(`modal_edit_return_${id}`)?.value || '',
        ticketsTaken: parseInt(document.getElementById(`modal_edit_tickets_${id}`)?.value) || 0
    };
    sheetData[id] = recalcRowFields(sheetData[id]);
    editingModalRowId = null;
    renderModalTable();
    showModalMessage('Record updated! Click "Save All Changes".', 'success');
}
function deleteModalRecord(id) {
    if (!isAdmin()) return;
    if (confirm('Delete this employee permanently from the loaded data? The change will be saved to Google Sheet when you click "Save All Changes".')) {
        sheetData.splice(id, 1);
        renderModalTable();
        showModalMessage('Record deleted. Click "Save All Changes" to sync with Google Sheet.', 'success');
        updateAnalytics();
    }
}
function deleteModalPdf(id) {
    if (!isAdmin()) return;
    if (confirm('Remove the uploaded PDF from this employee? The status will no longer be "Ticket Confirm".')) {
        sheetData[id].hasPdf = false;
        sheetData[id].pdfName = '';
        sheetData[id].pdfBase64 = '';
        sheetData[id] = recalcRowFields(sheetData[id]);
        renderModalTable();
        showModalMessage('PDF removed. Click "Save All Changes" to sync with Google Sheet.', 'success');
        updateAnalytics();
    }
}
function uploadModalPdf(id) { if (isAdmin()) { currentModalPdfIndex = id; document.getElementById('modalPdfUploadInput').click(); } }
function viewModalPdfLarge(id) { const emp = sheetData[id]; if (emp?.pdfBase64) showLargePdf(emp.pdfBase64, emp.pdfName, emp.employeeName); else alert('No PDF'); }
document.getElementById('modalPdfUploadInput').onchange = function(e) {
    if (!isAdmin()) return;
    const file = e.target.files[0];
    if (!file || currentModalPdfIndex === null) return;
    if (file.type !== 'application/pdf') { alert('PDF only'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
        if (currentModalPdfIndex < sheetData.length) {
            sheetData[currentModalPdfIndex].hasPdf = true;
            sheetData[currentModalPdfIndex].pdfName = file.name;
            sheetData[currentModalPdfIndex].pdfBase64 = ev.target.result;
            sheetData[currentModalPdfIndex] = recalcRowFields(sheetData[currentModalPdfIndex]);
            renderModalTable();
            showModalMessage('PDF uploaded! Status → Ticket Confirm', 'success');
        }
        currentModalPdfIndex = null;
    };
    reader.readAsDataURL(file);
    this.value = '';
};
function showModalMessage(msg, type) {
    const div = document.getElementById('modalMessage');
    div.style.display = 'block';
    div.style.background = type === 'success' ? '#d4edda' : '#f8d7da';
    div.style.color = type === 'success' ? '#155724' : '#721c24';
    div.style.border = type === 'success' ? '1px solid #c3e6cb' : '1px solid #f5c6cb';
    div.innerHTML = msg;
    setTimeout(() => div.style.display = 'none', 3000);
}
function openModal() { document.getElementById('sheetModal').style.display = 'block'; }
function closeModal() { document.getElementById('sheetModal').style.display = 'none'; editingModalRowId = null; }

// ========== GOOGLE SHEET FUNCTIONS ==========
async function loadFromGoogleSheet() {
    updateSyncLabel('Loading from Sheet...');
    try {
        const res = await fetch(GOOGLE_URL);
        const data = await res.json();
        if (Array.isArray(data)) {
            if (!data.length) {
                updateSyncLabel('No records', true);
                showModalMessage('No records found', 'error');
                sheetData = [];
            } else {
                sheetData = data.map(row => recalcRowFields({
                    employeeName: row.employeeName || row.Employee || '',
                    remarks: row.remarks || row.Remarks || '',
                    departure: row.departure ? formatDateToYMD(row.departure) : '',
                    return: row.return ? formatDateToYMD(row.return) : '',
                    ticketsTaken: row.ticketsTaken || row.TicketsTaken || 0,
                    hasPdf: row.hasPdf || row.HasPDF === 'TRUE' || false,
                    pdfName: row.pdfName || row.PDFName || '',
                    pdfBase64: row.pdfBase64 || row.PDFBase64 || '',
                    status: row.status || row.Status || ''
                }));
                updateSyncLabel(`✅ Loaded ${sheetData.length} records`);
                showModalMessage(`Loaded ${sheetData.length} records!`, 'success');
            }
            renderModalTable();
            updateAnalytics();
        } else throw new Error('Invalid response');
    } catch (err) {
        updateSyncLabel('❌ Load failed', true);
        showModalMessage('Failed to load: ' + err.message, 'error');
    }
}
async function saveModalToGoogleSheet() {
    if (!isAdmin()) return;
    if (!sheetData.length) { showModalMessage('No data to save', 'error'); return; }
    updateSyncLabel('Saving...');
    const payload = sheetData.map(e => ({
        employeeName: e.employeeName, remarks: e.remarks, departure: e.departure, return: e.return,
        totalDay: e.vacationDays, ticketsTaken: e.ticketsTaken, hasPdf: e.hasPdf, pdfName: e.pdfName,
        pdfBase64: e.pdfBase64, status: e.status
    }));
    try {
        await fetch(GOOGLE_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        updateSyncLabel('✓ Saved');
        showModalMessage('Changes saved!', 'success');
        setTimeout(() => closeModal(), 1500);
    } catch (err) { updateSyncLabel('✗ Error', true); showModalMessage('Error: ' + err.message, 'error'); }
}
async function saveNewRecordsToSheet() {
    if (!isAdmin()) return;
    if (!employeesData.length) { alert('No new records to save.'); return; }
    updateSyncLabel('Saving new records...');
    let existing = [];
    try { const res = await fetch(GOOGLE_URL); const ex = await res.json(); if (Array.isArray(ex)) existing = ex; } catch(e) {}
    const all = [...existing, ...employeesData.map(e => ({
        employeeName: e.employeeName, remarks: e.remarks, departure: e.departure, return: e.return,
        totalDay: e.vacationDays, ticketsTaken: e.ticketsTaken, hasPdf: e.hasPdf, pdfName: e.pdfName,
        pdfBase64: e.pdfBase64, status: e.status
    }))];
    try {
        await fetch(GOOGLE_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(all) });
        updateSyncLabel('✓ Saved');
        alert(`Saved ${employeesData.length} new records!`);
        employeesData = [];
        renderMainTable();
        await loadFromGoogleSheet();
    } catch (err) { updateSyncLabel('✗ Error', true); alert('Error saving: ' + err.message); }
}
async function refreshAndLoad() { await loadFromGoogleSheet(); openModal(); }
function viewLoadedData() { if (sheetData.length) { renderModalTable(); openModal(); } else alert('No data loaded. Click "Refresh & Load" first.'); }
async function testConnection() {
    updateSyncLabel('Testing...');
    try { const res = await fetch(GOOGLE_URL); const data = await res.json(); alert(`✅ Connected! Found ${data.length} records.`); updateSyncLabel('✓ Connected'); }
    catch(e) { updateSyncLabel('❌ Failed', true); alert('Cannot connect.'); }
}
function addNewRecord() { if (isAdmin()) { employeesData.push({ employeeName: '', remarks: '', departure: '', return: '', ticketsTaken: 0, hasPdf: false, pdfName: null, pdfBase64: null }); renderMainTable(); } }
function clearAllNewRecords() { if (isAdmin() && confirm('Clear all new records?')) { employeesData = []; renderMainTable(); } }
function updateSyncLabel(text, isError = false) { const s = document.getElementById('syncStatusLabel'); if (s) { s.innerText = text; s.style.color = isError ? '#ffb74d' : '#b9f6ca'; } }

// ========== INITIALIZATION ==========
function initializeApp() {
    document.getElementById('addNewRowBtn').onclick = addNewRecord;
    document.getElementById('clearAllBtn').onclick = clearAllNewRecords;
    document.getElementById('refreshDataBtn').onclick = refreshAndLoad;
    document.getElementById('viewLoadedDataBtn').onclick = viewLoadedData;
    document.getElementById('syncToGoogleBtn').onclick = saveNewRecordsToSheet;
    document.getElementById('testConnectionBtn').onclick = testConnection;
    document.getElementById('saveModalChangesBtn').onclick = saveModalToGoogleSheet;
    document.getElementById('refreshAnalyticsBtn').onclick = () => updateAnalytics();
    document.getElementById('closeModalBtn').onclick = closeModal;
    document.getElementById('closeModalBtn2').onclick = closeModal;
    document.getElementById('closePdfViewerModal').onclick = closeLargePdf;
    window.onclick = (e) => { if (e.target === document.getElementById('pdfViewerModal')) closeLargePdf(); if (e.target === document.getElementById('sheetModal')) closeModal(); };
    window.deleteNewRecord = deleteNewRecord;
    window.startModalEdit = startModalEdit;
    window.cancelModalEdit = cancelModalEdit;
    window.saveModalEdit = saveModalEdit;
    window.uploadModalPdf = uploadModalPdf;
    window.viewModalPdfLarge = viewModalPdfLarge;
    window.deleteModalRecord = deleteModalRecord;
    window.deleteModalPdf = deleteModalPdf;
    employeesData = [];
    renderMainTable();
    updateSyncLabel('Ready');
}
window.addEventListener('load', () => {
    document.getElementById('loginModal').style.display = 'flex';
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('mainFooter').style.display = 'none';
});
