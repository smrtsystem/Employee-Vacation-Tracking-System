// ======================== USER AUTHENTICATION ========================
let currentUserRole = null;
let currentUserName = null;

// Valid users
const users = {
    admin: { password: "535680", role: "admin", name: "Administrator" },
    user: { password: "742744", role: "user", name: "Normal User" }
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

function isAdmin() {
    return currentUserRole === 'admin';
}

// ======================== GOOGLE SCRIPT URL ========================
const EMBEDDED_GOOGLE_URL = "https://script.google.com/macros/s/AKfycbyOaEqHirF2nZhAT-jSwTvDSVLFvuwbhKRDaZNJpTsOG2-KrQXGYpwm-YLkTU0KNorh/exec";

let employeesData = [];
let sheetData = [];
let currentPdfIndex = null;
let currentModalPdfIndex = null;
let editingModalRowId = null;
let GOOGLE_URL = EMBEDDED_GOOGLE_URL;

// Chart instances
let monthlyChart = null;
let statusChart = null;

// ========== HELPER FUNCTIONS ==========
function getToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function calculateVacationDays(departureStr, returnStr) {
    if (!departureStr || !returnStr) return 0;
    const start = new Date(departureStr);
    const end = new Date(returnStr);
    if (isNaN(start) || isNaN(end)) return 0;
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function calculateDaysUntilDeparture(departureStr) {
    if (!departureStr) return 0;
    const departure = new Date(departureStr);
    const today = getToday();
    if (isNaN(departure)) return 0;
    const diffDays = Math.ceil((departure - today) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

function calculateDaysAfterReturn(returnStr) {
    if (!returnStr) return 0;
    const returnDate = new Date(returnStr);
    const today = getToday();
    if (isNaN(returnDate)) return 0;
    const diffDays = Math.ceil((today - returnDate) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
}

function formatDateToYMD(dateValue) {
    if (!dateValue) return '';
    if (typeof dateValue === 'string' && dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) return dateValue;
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
    }
    return '';
}

function recalcRowFields(row) {
    row.vacationDays = calculateVacationDays(row.departure, row.return);
    row.daysUntilDeparture = calculateDaysUntilDeparture(row.departure);
    row.daysAfterReturn = calculateDaysAfterReturn(row.return);
    let tickets = parseInt(row.ticketsTaken) || 0;
    row.ticketsTaken = tickets;
    if (row.hasPdf && row.pdfName) {
        row.status = "Ticket Confirm";
    } else if (row.departure && row.return) {
        const today = getToday();
        const dep = new Date(row.departure);
        const ret = new Date(row.return);
        if (today > ret) row.status = "Completed";
        else if (today >= dep && today <= ret) row.status = "Ongoing";
        else if (today < dep) row.status = "Upcoming";
        else row.status = "Pending";
    } else {
        row.status = "Draft";
    }
    return row;
}

function updateStatsUI() {
    const total = employeesData.length;
    let totalVacationDays = 0, totalTickets = 0, confirmed = 0;
    employeesData.forEach(emp => {
        totalVacationDays += emp.vacationDays || 0;
        totalTickets += emp.ticketsTaken || 0;
        if (emp.hasPdf && emp.status === "Ticket Confirm") confirmed++;
    });
    document.getElementById('totalEmployeesStat').innerText = total;
    document.getElementById('totalVacationDaysStat').innerText = totalVacationDays;
    document.getElementById('totalTicketsStat').innerText = totalTickets;
    document.getElementById('confirmedStat').innerText = confirmed;
}

function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }

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

    // Summary calculations
    const totalEmployees = sheetData.length;
    const totalVacationDays = sheetData.reduce((sum, e) => sum + (e.vacationDays || 0), 0);
    const avgVacationDays = totalEmployees ? (totalVacationDays / totalEmployees).toFixed(1) : 0;
    const upcoming = sheetData.filter(e => e.status === 'Upcoming').length;
    const ongoing = sheetData.filter(e => e.status === 'Ongoing').length;
    const confirmed = sheetData.filter(e => e.hasPdf && e.status === 'Ticket Confirm').length;

    document.getElementById('analyticsTotalEmployees').innerText = totalEmployees;
    document.getElementById('analyticsTotalVacationDays').innerText = totalVacationDays;
    document.getElementById('analyticsAvgVacationDays').innerText = avgVacationDays;
    document.getElementById('analyticsUpcoming').innerText = upcoming;
    document.getElementById('analyticsOngoing').innerText = ongoing;
    document.getElementById('analyticsConfirmed').innerText = confirmed;

    // Monthly chart data (vacation days per month from departure dates)
    const monthMap = new Map();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    sheetData.forEach(emp => {
        if (emp.departure) {
            const depDate = new Date(emp.departure);
            if (!isNaN(depDate)) {
                const month = depDate.getMonth();
                const days = emp.vacationDays || 0;
                monthMap.set(month, (monthMap.get(month) || 0) + days);
            }
        }
    });
    const monthlyLabels = [];
    const monthlyData = [];
    for (let i = 0; i < 12; i++) {
        monthlyLabels.push(monthNames[i]);
        monthlyData.push(monthMap.get(i) || 0);
    }

    // Status distribution
    const statusCounts = {
        'Ticket Confirm': sheetData.filter(e => e.status === 'Ticket Confirm').length,
        'Upcoming': sheetData.filter(e => e.status === 'Upcoming').length,
        'Ongoing': sheetData.filter(e => e.status === 'Ongoing').length,
        'Completed': sheetData.filter(e => e.status === 'Completed').length,
        'Pending': sheetData.filter(e => e.status === 'Pending').length,
        'Draft': sheetData.filter(e => e.status === 'Draft').length
    };

    // Destroy old charts if exist
    if (monthlyChart) monthlyChart.destroy();
    if (statusChart) statusChart.destroy();

    // Create new charts
    const ctxBar = document.getElementById('monthlyChart').getContext('2d');
    monthlyChart = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: monthlyLabels,
            datasets: [{
                label: 'Total Vacation Days',
                data: monthlyData,
                backgroundColor: 'rgba(30, 111, 92, 0.7)',
                borderColor: '#1e6f5c',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { position: 'top' } }
        }
    });

    const ctxPie = document.getElementById('statusChart').getContext('2d');
    statusChart = new Chart(ctxPie, {
        type: 'pie',
        data: {
            labels: Object.keys(statusCounts),
            datasets: [{
                data: Object.values(statusCounts),
                backgroundColor: ['#2e7d64', '#ffc107', '#17a2b8', '#28a745', '#fd7e14', '#6c757d'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { position: 'right' } }
        }
    });
}

// ========== MAIN TABLE RENDER (New Records Only) ==========
function renderMainTable() {
    const tbody = document.getElementById('tableBody');
    const admin = isAdmin();

    if (!employeesData.length) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:2.5rem;">Click "Add New Record" to add employee</td}</table>`;
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
        const departureFormatted = formatDateToYMD(fresh.departure);
        const returnFormatted = formatDateToYMD(fresh.return);

        html += `<tr data-idx="${idx}"><td>${idx + 1}</td>`;
        if (admin) {
            html += `<td><input type="text" class="emp-name" value="${escapeHtml(fresh.employeeName || '')}" placeholder="Enter name" data-idx="${idx}" style="width:140px"></td>
                     <td><input type="text" class="emp-remarks" value="${escapeHtml(fresh.remarks || '')}" placeholder="Enter remarks" data-idx="${idx}" style="width:150px"></td>
                     <td><input type="date" class="emp-departure" value="${departureFormatted}" data-idx="${idx}"></td>
                     <td><input type="date" class="emp-return" value="${returnFormatted}" data-idx="${idx}"></td>`;
        } else {
            html += `<td class="readonly-cell">${escapeHtml(fresh.employeeName || '-')}</td>
                     <td class="readonly-cell">${escapeHtml(fresh.remarks || '-')}</td>
                     <td class="readonly-cell">${fresh.departure || '-'}</td>
                     <td class="readonly-cell">${fresh.return || '-'}</td>`;
        }
        html += `<td class="vacation-cell">${fresh.vacationDays}</td>`;
        if (admin) {
            html += `<td><input type="number" class="emp-tickets" value="${fresh.ticketsTaken}" min="0" style="width:70px" data-idx="${idx}"></td>`;
        } else {
            html += `<td class="readonly-cell">${fresh.ticketsTaken}</td>`;
        }
        html += `<td>
                    ${admin ? `<button class="${pdfBtnClass}" data-idx="${idx}">${pdfBtnText}</button>` : (fresh.hasPdf ? '<span style="color:#2e7d64;">✓ PDF</span>' : '-')}
                    ${fresh.pdfName && admin ? `<div class="pdf-name-display">${fresh.pdfName.substring(0, 12)}</div>` : ''}
                  </td>
                  <td><span class="${statusClass}">${fresh.status}</span></td>
                  <td class="days-until-cell">${fresh.daysUntilDeparture}</td>
                  <td class="days-after-cell">${fresh.daysAfterReturn}</td>
                  <td class="action-buttons">
                    ${admin ? `<button class="action-btn delete-btn" onclick="deleteNewRecord(${idx})">🗑️ Delete</button>` : ''}
                  </td>
                </tr>`;
    });
    tbody.innerHTML = html;
    attachMainEvents();
    updateStatsUI();
}

function attachMainEvents() {
    if (!isAdmin()) return;
    document.querySelectorAll('.pdf-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const idxAttr = btn.getAttribute('data-idx');
            if (idxAttr !== null) { currentPdfIndex = parseInt(idxAttr, 10); document.getElementById('pdfUploadInput').click(); }
        };
    });
    document.querySelectorAll('.emp-name, .emp-remarks, .emp-departure, .emp-return, .emp-tickets').forEach(input => {
        input.onchange = () => updateMainRowCalculation(parseInt(input.dataset.idx));
        input.oninput = () => updateMainRowCalculation(parseInt(input.dataset.idx));
    });
}

function updateMainRowCalculation(idx) {
    if (!isAdmin()) return;
    const nameInp = document.querySelector(`.emp-name[data-idx="${idx}"]`);
    const remarksInp = document.querySelector(`.emp-remarks[data-idx="${idx}"]`);
    const depInp = document.querySelector(`.emp-departure[data-idx="${idx}"]`);
    const retInp = document.querySelector(`.emp-return[data-idx="${idx}"]`);
    const ticketsInp = document.querySelector(`.emp-tickets[data-idx="${idx}"]`);
    if (nameInp) employeesData[idx].employeeName = nameInp.value;
    if (remarksInp) employeesData[idx].remarks = remarksInp.value;
    if (depInp) employeesData[idx].departure = depInp.value;
    if (retInp) employeesData[idx].return = retInp.value;
    if (ticketsInp) employeesData[idx].ticketsTaken = parseInt(ticketsInp.value) || 0;
    employeesData[idx] = recalcRowFields(employeesData[idx]);
    const vacationCell = document.querySelector(`tr[data-idx="${idx}"] .vacation-cell`);
    const daysUntilCell = document.querySelector(`tr[data-idx="${idx}"] .days-until-cell`);
    const daysAfterCell = document.querySelector(`tr[data-idx="${idx}"] .days-after-cell`);
    const statusSpan = document.querySelector(`tr[data-idx="${idx}"] td:nth-child(9) span`);
    if (vacationCell) vacationCell.innerText = employeesData[idx].vacationDays;
    if (daysUntilCell) daysUntilCell.innerText = employeesData[idx].daysUntilDeparture;
    if (daysAfterCell) daysAfterCell.innerText = employeesData[idx].daysAfterReturn;
    if (statusSpan) {
        let newClass = 'status-pending';
        if (employeesData[idx].status === 'Ticket Confirm') newClass = 'status-confirmed';
        else if (employeesData[idx].status === 'Completed') newClass = 'status-completed';
        else if (employeesData[idx].status === 'Upcoming') newClass = 'status-upcoming';
        statusSpan.className = newClass;
        statusSpan.innerText = employeesData[idx].status;
    }
    updateStatsUI();
}

document.getElementById('pdfUploadInput').onchange = function(e) {
    if (!isAdmin()) return;
    const file = e.target.files[0];
    if (!file || currentPdfIndex === null) return;
    if (file.type !== 'application/pdf') { alert('Please select a PDF file'); return; }
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

function deleteNewRecord(id) {
    if (!isAdmin()) return;
    if (confirm('Delete this new record?')) {
        employeesData.splice(id, 1);
        renderMainTable();
    }
}

// ========== LARGE PDF VIEWER ==========
function showLargePdf(pdfData, fileName, employeeName) {
    const modal = document.getElementById('pdfViewerModal');
    const frame = document.getElementById('pdfViewerFrame');
    document.getElementById('pdfViewerTitle').innerHTML = `<i class="fas fa-file-pdf"></i> ${escapeHtml(employeeName)} - Ticket PDF`;
    document.getElementById('pdfFileNameDisplay').innerHTML = `<i class="fas fa-ticket-alt"></i> ${escapeHtml(fileName)}`;
    frame.src = pdfData;
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
    if (!sheetData.length) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align:center; padding:40px;">No records found. Click "Refresh & Load" first.</td></tr>';
        return;
    }
    let html = '';
    sheetData.forEach((emp, idx) => {
        const isEditing = (admin && editingModalRowId === idx);
        const fresh = recalcRowFields({ ...emp });
        sheetData[idx] = fresh;
        let statusClass = 'status-pending';
        if (fresh.status === 'Ticket Confirm') statusClass = 'status-confirmed';
        else if (fresh.status === 'Completed') statusClass = 'status-completed';
        else if (fresh.status === 'Upcoming') statusClass = 'status-upcoming';
        const departureDisplay = fresh.departure ? fresh.departure : '-';
        const returnDisplay = fresh.return ? fresh.return : '-';
        const departureFormatted = formatDateToYMD(fresh.departure);
        const returnFormatted = formatDateToYMD(fresh.return);
        if (isEditing) {
            html += `<tr style="background:#fff3cd;">
                        <td>${idx + 1}</td>
                        <td><input type="text" id="modal_edit_name_${idx}" value="${escapeHtml(fresh.employeeName || '')}" style="width:120px"></td>
                        <td><input type="text" id="modal_edit_remarks_${idx}" value="${escapeHtml(fresh.remarks || '')}" style="width:120px"></td>
                        <td><input type="date" id="modal_edit_departure_${idx}" value="${departureFormatted}"></td>
                        <td><input type="date" id="modal_edit_return_${idx}" value="${returnFormatted}"></td>
                        <td>${fresh.vacationDays}</td>
                        <td><input type="number" id="modal_edit_tickets_${idx}" value="${fresh.ticketsTaken}" min="0" style="width:60px"></td>
                        <td><button class="action-btn upload-pdf-btn" onclick="uploadModalPdf(${idx})">📄 ${fresh.hasPdf ? 'Change PDF' : 'Upload'}</button>${fresh.pdfName ? `<div class="pdf-name-display">${fresh.pdfName.substring(0,10)}</div>` : ''}</td>
                        <td><span class="${statusClass}">${fresh.status}</span></td>
                        <td>${fresh.daysUntilDeparture}</td>
                        <td>${fresh.daysAfterReturn}</td>
                        <td class="modal-actions"><button class="action-btn save-edit-btn" onclick="saveModalEdit(${idx})">💾 Save</button><button class="action-btn cancel-edit-btn" onclick="cancelModalEdit()">❌ Cancel</button></td>
                      </tr>`;
        } else {
            html += `<tr>
                        <td>${idx + 1}</td>
                        <td>${escapeHtml(fresh.employeeName || '-')}</td>
                        <td>${escapeHtml(fresh.remarks || '-')}</td>
                        <td>${departureDisplay}</td>
                        <td>${returnDisplay}</td>
                        <td>${fresh.vacationDays}</td>
                        <td>${fresh.ticketsTaken}</td>
                        <td>${fresh.hasPdf ? `<span style="color:#2e7d64;">✓ PDF</span><br><span style="font-size:9px;">${fresh.pdfName.substring(0,10)}</span>` : '-'}</td>
                        <td><span class="${statusClass}">${fresh.status}</span></td>
                        <td>${fresh.daysUntilDeparture}</td>
                        <td>${fresh.daysAfterReturn}</td>
                        <td class="modal-actions">${admin ? `<button class="action-btn edit-btn" onclick="startModalEdit(${idx})">✏️ Edit</button>` : ''}${fresh.hasPdf ? `<button class="action-btn view-pdf-btn" onclick="viewModalPdfLarge(${idx})">👁️ View PDF</button>` : ''}</td>
                      </tr>`;
        }
    });
    tbody.innerHTML = html;
}

function startModalEdit(id) { if (!isAdmin()) return; editingModalRowId = id; renderModalTable(); }
function cancelModalEdit() { editingModalRowId = null; renderModalTable(); }
function saveModalEdit(id) {
    if (!isAdmin()) return;
    const newName = document.getElementById(`modal_edit_name_${id}`)?.value || '';
    const newRemarks = document.getElementById(`modal_edit_remarks_${id}`)?.value || '';
    const newDeparture = document.getElementById(`modal_edit_departure_${id}`)?.value || '';
    const newReturn = document.getElementById(`modal_edit_return_${id}`)?.value || '';
    const newTickets = parseInt(document.getElementById(`modal_edit_tickets_${id}`)?.value) || 0;
    sheetData[id] = { ...sheetData[id], employeeName: newName, remarks: newRemarks, departure: newDeparture, return: newReturn, ticketsTaken: newTickets };
    sheetData[id] = recalcRowFields(sheetData[id]);
    editingModalRowId = null;
    renderModalTable();
    showModalMessage('Record updated! Click "Save All Changes" to sync with Google Sheet.', 'success');
}
function uploadModalPdf(id) { if (!isAdmin()) return; currentModalPdfIndex = id; document.getElementById('modalPdfUploadInput').click(); }
function viewModalPdfLarge(id) { const emp = sheetData[id]; if (emp && emp.pdfBase64) showLargePdf(emp.pdfBase64, emp.pdfName, emp.employeeName); else alert('No PDF ticket stored.'); }

document.getElementById('modalPdfUploadInput').onchange = function(e) {
    if (!isAdmin()) return;
    const file = e.target.files[0];
    if (!file || currentModalPdfIndex === null) return;
    if (file.type !== 'application/pdf') { alert('Please select a PDF file'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
        if (currentModalPdfIndex < sheetData.length) {
            sheetData[currentModalPdfIndex].hasPdf = true;
            sheetData[currentModalPdfIndex].pdfName = file.name;
            sheetData[currentModalPdfIndex].pdfBase64 = ev.target.result;
            sheetData[currentModalPdfIndex] = recalcRowFields(sheetData[currentModalPdfIndex]);
            renderModalTable();
            showModalMessage('PDF uploaded! Status changed to "Ticket Confirm"', 'success');
        }
        currentModalPdfIndex = null;
    };
    reader.readAsDataURL(file);
    this.value = '';
};

function showModalMessage(msg, type) {
    const msgDiv = document.getElementById('modalMessage');
    msgDiv.style.display = 'block';
    msgDiv.style.background = type === 'success' ? '#d4edda' : '#f8d7da';
    msgDiv.style.color = type === 'success' ? '#155724' : '#721c24';
    msgDiv.style.border = type === 'success' ? '1px solid #c3e6cb' : '1px solid #f5c6cb';
    msgDiv.innerHTML = msg;
    setTimeout(() => msgDiv.style.display = 'none', 3000);
}
function openModal() { document.getElementById('sheetModal').style.display = 'block'; }
function closeModal() { document.getElementById('sheetModal').style.display = 'none'; editingModalRowId = null; }

// ========== GOOGLE SHEET FUNCTIONS ==========
async function loadFromGoogleSheet() {
    updateSyncLabel('Loading from Sheet...');
    try {
        const response = await fetch(GOOGLE_URL);
        const data = await response.json();
        if (Array.isArray(data)) {
            if (data.length === 0) {
                updateSyncLabel('No records found', true);
                showModalMessage('No records found in Google Sheet', 'error');
                sheetData = [];
            } else {
                sheetData = data.map(row => {
                    let departureDate = row.departure ? formatDateToYMD(row.departure) : '';
                    let returnDate = row.return ? formatDateToYMD(row.return) : '';
                    return recalcRowFields({
                        employeeName: row.employeeName || row.Employee || '',
                        remarks: row.remarks || row.Remarks || '',
                        departure: departureDate,
                        return: returnDate,
                        ticketsTaken: row.ticketsTaken || row.TicketsTaken || 0,
                        hasPdf: row.hasPdf || row.HasPDF === 'TRUE' || false,
                        pdfName: row.pdfName || row.PDFName || '',
                        pdfBase64: row.pdfBase64 || row.PDFBase64 || '',
                        status: row.status || row.Status || ''
                    });
                });
                updateSyncLabel(`✅ Loaded ${sheetData.length} records`);
                showModalMessage(`Successfully loaded ${sheetData.length} records from Google Sheet!`, 'success');
            }
            renderModalTable();
            updateAnalytics();  // <-- refresh charts
        } else throw new Error('Invalid response');
    } catch (err) {
        updateSyncLabel('❌ Load failed', true);
        showModalMessage('Failed to load from Google Sheet: ' + err.message, 'error');
    }
}

async function saveModalToGoogleSheet() {
    if (!isAdmin()) return;
    if (sheetData.length === 0) { showModalMessage('No data to save', 'error'); return; }
    updateSyncLabel('Saving to Sheet...');
    const payload = sheetData.map(emp => ({
        employeeName: emp.employeeName, remarks: emp.remarks, departure: emp.departure, return: emp.return,
        totalDay: emp.vacationDays, ticketsTaken: emp.ticketsTaken, hasPdf: emp.hasPdf, pdfName: emp.pdfName,
        pdfBase64: emp.pdfBase64, status: emp.status, afterVacWorkingDays: emp.daysAfterReturn, remainingDays: emp.daysUntilDeparture
    }));
    try {
        await fetch(GOOGLE_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        updateSyncLabel('✓ Saved to Sheet');
        showModalMessage('Changes saved to Google Sheet successfully!', 'success');
        setTimeout(() => { closeModal(); loadFromGoogleSheet(); }, 1500);
    } catch (err) { updateSyncLabel('✗ Save error', true); showModalMessage('Error saving: ' + err.message, 'error'); }
}

async function saveNewRecordsToSheet() {
    if (!isAdmin()) return;
    if (employeesData.length === 0) { alert('No new records to save. Add records first.'); return; }
    updateSyncLabel('Saving new records...');
    let existingData = [];
    try { const res = await fetch(GOOGLE_URL); const existing = await res.json(); if (Array.isArray(existing)) existingData = existing; } catch(e) {}
    const allRecords = [...existingData, ...employeesData.map(emp => ({
        employeeName: emp.employeeName, remarks: emp.remarks, departure: emp.departure, return: emp.return,
        totalDay: emp.vacationDays, ticketsTaken: emp.ticketsTaken, hasPdf: emp.hasPdf, pdfName: emp.pdfName,
        pdfBase64: emp.pdfBase64, status: emp.status, afterVacWorkingDays: emp.daysAfterReturn, remainingDays: emp.daysUntilDeparture
    }))];
    try {
        await fetch(GOOGLE_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(allRecords) });
        updateSyncLabel('✓ New records saved');
        alert(`Saved ${employeesData.length} new records to Google Sheet!`);
        employeesData = [];
        renderMainTable();
        await loadFromGoogleSheet();
    } catch (err) { updateSyncLabel('✗ Save error', true); alert('Error saving: ' + err.message); }
}

async function refreshAndLoad() { await loadFromGoogleSheet(); openModal(); }
function viewLoadedData() {
    if (sheetData.length === 0) alert('No data loaded yet. Click "Refresh & Load" first.');
    else { renderModalTable(); openModal(); }
}
async function testConnection() {
    updateSyncLabel('Testing...');
    try { const res = await fetch(GOOGLE_URL); const data = await res.json(); alert(`✅ Connection successful!\nFound ${Array.isArray(data) ? data.length : '0'} records.`); updateSyncLabel('✓ Connected'); }
    catch(e) { updateSyncLabel('❌ Failed', true); alert('Cannot connect to Apps Script.'); }
}
function addNewRecord() { if (!isAdmin()) return; employeesData.push({ employeeName: '', remarks: '', departure: '', return: '', ticketsTaken: 0, hasPdf: false, pdfName: null, pdfBase64: null }); renderMainTable(); setTimeout(() => { const newInput = document.querySelector(`.emp-name[data-idx="${employeesData.length-1}"]`); if (newInput) newInput.focus(); }, 100); }
function clearAllNewRecords() { if (!isAdmin()) return; if (confirm('Clear ALL new records from this view?')) { employeesData = []; renderMainTable(); } }
function updateSyncLabel(text, isError = false) { const span = document.getElementById('syncStatusLabel'); if (span) { span.innerText = text; span.style.color = isError ? '#ffb74d' : '#b9f6ca'; } }

function initializeApp() {
    document.getElementById('addNewRowBtn').addEventListener('click', addNewRecord);
    document.getElementById('clearAllBtn').addEventListener('click', clearAllNewRecords);
    document.getElementById('refreshDataBtn').addEventListener('click', refreshAndLoad);
    document.getElementById('viewLoadedDataBtn').addEventListener('click', viewLoadedData);
    document.getElementById('syncToGoogleBtn').addEventListener('click', saveNewRecordsToSheet);
    document.getElementById('testConnectionBtn').addEventListener('click', testConnection);
    document.getElementById('saveModalChangesBtn').addEventListener('click', saveModalToGoogleSheet);
    document.getElementById('refreshAnalyticsBtn').addEventListener('click', () => updateAnalytics());
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
    employeesData = [];
    renderMainTable();
    updateSyncLabel("Ready");
}

window.addEventListener('load', function() {
    document.getElementById('loginModal').style.display = 'flex';
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('mainFooter').style.display = 'none';
});