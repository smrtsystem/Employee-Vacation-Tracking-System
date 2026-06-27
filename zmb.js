
/**
 * ============================================================
 * ZMB EMPLOYEES · Complete JavaScript Module
 * ============================================================
 */

// ----- CONFIG -----
// ⚠️ REPLACE WITH YOUR ACTUAL GOOGLE APPS SCRIPT URL
const ZMB_GOOGLE_URL = "https://script.google.com/macros/s/AKfycbxP5ItVFDfZPwV6FZkVB_H2z8BwwPcrbEU-xiHuIFjuPS24q88uklEYVfWutJBL2t4y/exec";
const ZMB_SHEET_NAME = "zmbemployees";

let zmbData = [];
let zmbEditingRowId = null;
let currentUser = 'Guest';
let zmbLoadAttempts = 0;

// ----- DOM refs -----
const $ = id => document.getElementById(id);
const zmbModal = $('zmbModal');
const zmbTableBody = $('zmbTableBody');
const zmbSyncStatus = $('zmbSyncStatus');
const zmbTotalCount = $('zmbTotalCount');
const zmbTotalLeave = $('zmbTotalLeave');
const zmbModalMessage = $('zmbModalMessage');
const zmbCurrentUser = $('zmbCurrentUser');

// ----- UTILITY functions -----
function formatDateToYMD(dateValue) {
    if (!dateValue) return '';
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDateLocal(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split(/[-/]/);
    if (parts.length === 3) {
        let y = parseInt(parts[0]);
        let m = parseInt(parts[1]) - 1;
        let d = parseInt(parts[2]);
        if (y < 1000) {
            y = parseInt(parts[2]);
            m = parseInt(parts[1]) - 1;
            d = parseInt(parts[0]);
        }
        return new Date(y, m, d);
    }
    return null;
}

function calculateLeaveDays(startStr, endStr) {
    if (!startStr || !endStr) return 0;
    const start = parseDateLocal(startStr);
    const end = parseDateLocal(endStr);
    if (!start || !end) return 0;
    const diff = Math.ceil((end - start) / 86400000);
    return diff >= 0 ? diff + 1 : 0;
}

function getTodayYMD() {
    const d = new Date();
    return formatDateToYMD(d);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function showToast(msg, type = 'success') {
    if (zmbModalMessage) {
        zmbModalMessage.style.display = 'block';
        zmbModalMessage.className = 'toast-msg';
        zmbModalMessage.style.background = type === 'success' ? '#d4edda' : '#f8d7da';
        zmbModalMessage.style.color = type === 'success' ? '#155724' : '#721c24';
        zmbModalMessage.innerText = msg;
        setTimeout(() => { zmbModalMessage.style.display = 'none'; }, 3000);
    }
}

function updateSyncLabel(text, isError = false) {
    if (zmbSyncStatus) {
        zmbSyncStatus.innerHTML = `<i class="fas fa-sync-alt"></i> ${text}`;
        zmbSyncStatus.style.color = isError ? '#dc3545' : '#2e7d64';
    }
}

// ----- GOOGLE SHEET API -----
function buildZmbUrl() {
    const url = ZMB_GOOGLE_URL + '?sheet=' + encodeURIComponent(ZMB_SHEET_NAME);
    console.log('🔗 Built URL:', url);
    return url;
}

async function saveZmbToGoogleSheet(dataToSave) {
    try {
        if (!dataToSave || dataToSave.length === 0) {
            console.log('ℹ️ No data to save');
            return true;
        }
        
        const payload = dataToSave.map(r => ({
            'Record Date': r.recordDate || getTodayYMD(),
            'Employee Name': r.employeeName || '',
            'Start Date': r.startDate || '',
            'End Date': r.endDate || '',
            'Total Leave Days': parseInt(r.totalLeaveDays) || 0,
            'Approved By': r.approvedBy || '',
            'Current Shift': r.currentShift || '',
            'Remarks': r.remarks || ''
        }));
        
        const url = buildZmbUrl();
        console.log('💾 Saving to URL:', url);
        console.log('💾 Payload count:', payload.length);
        
        const response = await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        console.log('✅ Save request sent successfully');
        return true;
    } catch (err) {
        console.error('❌ Save error:', err);
        return false;
    }
}

async function loadZmbFromGoogleSheet() {
    updateSyncLabel('Loading from zmbemployees...');
    zmbLoadAttempts++;
    
    try {
        const url = buildZmbUrl();
        console.log('📖 Loading from URL:', url);
        
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const data = await res.json();
        console.log('📊 Raw response:', data);
        
        if (!Array.isArray(data)) {
            console.error('❌ Response is not an array:', data);
            zmbData = [];
            updateSyncLabel('❌ Invalid data format', true);
            renderZmbTable();
            updateZmbStats();
            return;
        }
        
        if (data.length === 0) {
            console.log('ℹ️ No data found in zmbemployees');
            zmbData = [];
            updateSyncLabel('ℹ️ No records in zmbemployees');
            renderZmbTable();
            updateZmbStats();
            return;
        }
        
        // Check if the data has zmbemployees headers
        const firstRow = data[0];
        const keys = Object.keys(firstRow);
        console.log('🔑 Keys in response:', keys);
        
        const hasZmbHeaders = keys.some(k => 
            k === 'Record Date' || k === 'Employee Name' || 
            k === 'Start Date' || k === 'End Date'
        );
        
        if (!hasZmbHeaders) {
            console.warn('⚠️ Data does NOT have zmbemployees headers');
            console.warn('⚠️ Expected: Record Date, Employee Name, Start Date, End Date');
            console.warn('⚠️ Found:', keys);
            
            await createZmbSheetWithTestData();
            
            setTimeout(async () => {
                console.log('🔄 Retrying load...');
                const retryRes = await fetch(url);
                const retryData = await retryRes.json();
                if (Array.isArray(retryData) && retryData.length > 0) {
                    processZmbData(retryData);
                } else {
                    zmbData = [];
                    updateSyncLabel('ℹ️ No records in zmbemployees');
                    renderZmbTable();
                    updateZmbStats();
                }
            }, 2000);
            return;
        }
        
        processZmbData(data);
        
    } catch (err) {
        updateSyncLabel('❌ Failed to load', true);
        console.error('❌ Load error:', err);
        
        if (zmbLoadAttempts < 3) {
            console.log('🔄 Retry attempt', zmbLoadAttempts, 'of 3');
            setTimeout(() => {
                loadZmbFromGoogleSheet();
            }, 3000);
        } else {
            zmbData = [];
            renderZmbTable();
            updateZmbStats();
        }
    }
}

function processZmbData(data) {
    if (!Array.isArray(data) || data.length === 0) {
        zmbData = [];
        updateSyncLabel('ℹ️ No records in zmbemployees');
        renderZmbTable();
        updateZmbStats();
        return;
    }
    
    const firstRow = data[0];
    const keys = Object.keys(firstRow);
    const hasZmbHeaders = keys.some(k => 
        k === 'Record Date' || k === 'Employee Name' || 
        k === 'Start Date' || k === 'End Date'
    );
    
    if (!hasZmbHeaders) {
        console.warn('⚠️ Data does NOT have zmbemployees headers');
        console.warn('⚠️ Found:', keys);
        zmbData = [];
        updateSyncLabel('⚠️ Wrong sheet - expected zmbemployees', true);
        renderZmbTable();
        updateZmbStats();
        return;
    }
    
    zmbData = data.map(row => ({
        recordDate: row['Record Date'] || row.recordDate || getTodayYMD(),
        employeeName: row['Employee Name'] || row.employeeName || '',
        startDate: row['Start Date'] || row.startDate || '',
        endDate: row['End Date'] || row.endDate || '',
        totalLeaveDays: parseInt(row['Total Leave Days'] || row.totalLeaveDays || 0),
        approvedBy: row['Approved By'] || row.approvedBy || '',
        currentShift: row['Current Shift'] || row.currentShift || '',
        remarks: row['Remarks'] || row.remarks || ''
    }));
    
    zmbData.forEach(r => {
        if (r.startDate && r.endDate) {
            r.totalLeaveDays = calculateLeaveDays(r.startDate, r.endDate);
        }
    });
    
    console.log(`✅ Loaded ${zmbData.length} records from zmbemployees`);
    updateSyncLabel(`✅ Loaded ${zmbData.length} records from zmbemployees`);
    renderZmbTable();
    updateZmbStats();
}

async function createZmbSheetWithTestData() {
    try {
        console.log('🔄 Attempting to create zmbemployees sheet...');
        const today = getTodayYMD();
        const testData = [{
            'Record Date': today,
            'Employee Name': 'Test Employee',
            'Start Date': today,
            'End Date': today,
            'Total Leave Days': 1,
            'Approved By': 'Admin',
            'Current Shift': 'Morning',
            'Remarks': 'Auto-created sheet - Add your records'
        }];
        
        const url = buildZmbUrl();
        console.log('📤 Sending test data to create sheet...');
        
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        });
        
        console.log('✅ Test data sent to create zmbemployees sheet');
        await new Promise(resolve => setTimeout(resolve, 3000));
        return true;
    } catch (err) {
        console.error('❌ Failed to create sheet:', err);
        return false;
    }
}

// ----- RENDER table -----
function renderZmbTable() {
    if (!zmbTableBody) return;

    if (!zmbData || zmbData.length === 0) {
        zmbTableBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:40px;">
            <i class="fas fa-info-circle" style="font-size:24px; display:block; margin-bottom:10px;"></i>
            No records in zmbemployees sheet.<br>
            Click "Refresh Data" to load or "Add Record" to create your first record.
        </td></tr>`;
        return;
    }

    let html = '';
    zmbData.forEach((rec, idx) => {
        const isEditing = (zmbEditingRowId === idx);
        const recordDate = rec.recordDate || getTodayYMD();

        if (isEditing) {
            html += `
                <tr style="background:#fff3cd;">
                    <td>${idx + 1}</td>
                    <td><input type="date" id="zmb_edit_recordDate_${idx}" value="${recordDate}" style="max-width:120px;"></td>
                    <td><input type="text" id="zmb_edit_name_${idx}" value="${escapeHtml(rec.employeeName)}" style="max-width:140px;"></td>
                    <td><input type="date" id="zmb_edit_start_${idx}" value="${rec.startDate || ''}" onchange="zmbRecalcLeaveDays(${idx})"></td>
                    <td><input type="date" id="zmb_edit_end_${idx}" value="${rec.endDate || ''}" onchange="zmbRecalcLeaveDays(${idx})"></td>
                    <td><input type="number" id="zmb_edit_leave_${idx}" value="${rec.totalLeaveDays || 0}" min="0" style="max-width:70px;"></td>
                    <td><input type="text" id="zmb_edit_approved_${idx}" value="${escapeHtml(rec.approvedBy)}" style="max-width:140px;"></td>
                    <td>
                        <select id="zmb_edit_shift_${idx}" style="max-width:120px;">
                            <option value="Morning" ${rec.currentShift === 'Morning' ? 'selected' : ''}>Morning</option>
                            <option value="Afternoon" ${rec.currentShift === 'Afternoon' ? 'selected' : ''}>Afternoon</option>
                            <option value="Night" ${rec.currentShift === 'Night' ? 'selected' : ''}>Night</option>
                        </select>
                    </td>
                    <td><input type="text" id="zmb_edit_remarks_${idx}" value="${escapeHtml(rec.remarks)}" style="max-width:140px;"></td>
                    <td>
                        <button class="action-btn save-edit-btn" onclick="zmbSaveEdit(${idx})">💾 Save</button>
                        <button class="action-btn cancel-edit-btn" onclick="zmbCancelEdit()">✖</button>
                    </td>
                </tr>
            `;
        } else {
            html += `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(recordDate)}</td>
                    <td>${escapeHtml(rec.employeeName || '-')}</td>
                    <td>${escapeHtml(rec.startDate || '-')}</td>
                    <td>${escapeHtml(rec.endDate || '-')}</td>
                    <td><strong>${rec.totalLeaveDays || 0}</strong></td>
                    <td>${escapeHtml(rec.approvedBy || '-')}</td>
                    <td><span class="status-badge ${rec.currentShift === 'Night' ? 'status-inactive' : 'status-active'}">${escapeHtml(rec.currentShift || '-')}</span></td>
                    <td>${escapeHtml(rec.remarks || '-')}</td>
                    <td>
                        <button class="action-btn edit-btn" onclick="zmbStartEdit(${idx})">✏️ Edit</button>
                        <button class="action-btn delete-btn" onclick="zmbDeleteRecord(${idx})">🗑️</button>
                    </td>
                </tr>
            `;
        }
    });
    zmbTableBody.innerHTML = html;
}

// ----- EDIT / DELETE / SAVE logic -----
window.zmbStartEdit = function(idx) {
    zmbEditingRowId = idx;
    renderZmbTable();
};

window.zmbCancelEdit = function() {
    zmbEditingRowId = null;
    renderZmbTable();
};

window.zmbRecalcLeaveDays = function(idx) {
    const startInput = document.getElementById(`zmb_edit_start_${idx}`);
    const endInput = document.getElementById(`zmb_edit_end_${idx}`);
    const leaveInput = document.getElementById(`zmb_edit_leave_${idx}`);
    if (startInput && endInput && leaveInput) {
        const days = calculateLeaveDays(startInput.value, endInput.value);
        leaveInput.value = days;
    }
};

window.zmbSaveEdit = async function(idx) {
    const recordDate = document.getElementById(`zmb_edit_recordDate_${idx}`)?.value || getTodayYMD();
    const employeeName = document.getElementById(`zmb_edit_name_${idx}`)?.value || '';
    const startDate = document.getElementById(`zmb_edit_start_${idx}`)?.value || '';
    const endDate = document.getElementById(`zmb_edit_end_${idx}`)?.value || '';
    const totalLeaveDays = parseInt(document.getElementById(`zmb_edit_leave_${idx}`)?.value) || 0;
    const approvedBy = document.getElementById(`zmb_edit_approved_${idx}`)?.value || '';
    const currentShift = document.getElementById(`zmb_edit_shift_${idx}`)?.value || 'Morning';
    const remarks = document.getElementById(`zmb_edit_remarks_${idx}`)?.value || '';

    zmbData[idx] = {
        recordDate,
        employeeName,
        startDate,
        endDate,
        totalLeaveDays: calculateLeaveDays(startDate, endDate),
        approvedBy,
        currentShift,
        remarks
    };
    zmbEditingRowId = null;
    renderZmbTable();
    updateZmbStats();
    
    const success = await saveZmbToGoogleSheet(zmbData);
    if (success) {
        showToast('Record updated & saved!', 'success');
        updateSyncLabel('✓ Saved');
    } else {
        showToast('Error saving to sheet', 'error');
        updateSyncLabel('✗ Error', true);
    }
};

window.zmbDeleteRecord = async function(idx) {
    if (!confirm('Delete this record permanently?')) return;
    zmbData.splice(idx, 1);
    if (zmbEditingRowId === idx) zmbEditingRowId = null;
    else if (zmbEditingRowId !== null && zmbEditingRowId > idx) zmbEditingRowId--;
    renderZmbTable();
    updateZmbStats();
    
    const success = await saveZmbToGoogleSheet(zmbData);
    if (success) {
        showToast('Record deleted', 'success');
        updateSyncLabel('✓ Deleted');
    } else {
        showToast('Error deleting', 'error');
        updateSyncLabel('✗ Error', true);
    }
};

// ----- ADD NEW RECORD -----
window.zmbAddNewRecord = function() {
    zmbEditingRowId = null;
    const newRec = {
        recordDate: getTodayYMD(),
        employeeName: '',
        startDate: '',
        endDate: '',
        totalLeaveDays: 0,
        approvedBy: '',
        currentShift: 'Morning',
        remarks: ''
    };
    zmbData.push(newRec);
    zmbEditingRowId = zmbData.length - 1;
    renderZmbTable();
    zmbModal.style.display = 'flex';
};

// ----- SAVE ALL -----
window.zmbSaveAll = async function() {
    if (zmbEditingRowId !== null) {
        zmbEditingRowId = null;
        renderZmbTable();
    }
    zmbData.forEach(r => {
        r.totalLeaveDays = calculateLeaveDays(r.startDate, r.endDate);
    });
    updateZmbStats();
    
    const success = await saveZmbToGoogleSheet(zmbData);
    if (success) {
        showToast('All records saved!', 'success');
        updateSyncLabel('✓ All saved');
    } else {
        showToast('Error saving', 'error');
        updateSyncLabel('✗ Error', true);
    }
};

// ----- UPDATE STATS -----
function updateZmbStats() {
    if (zmbTotalCount) zmbTotalCount.innerText = zmbData.length;
    const totalLeave = zmbData.reduce((sum, r) => sum + (r.totalLeaveDays || 0), 0);
    if (zmbTotalLeave) zmbTotalLeave.innerText = totalLeave;
}

// ----- MODAL controls -----
function openZmbModal() {
    zmbModal.style.display = 'flex';
    renderZmbTable();
}

function closeZmbModal() {
    zmbModal.style.display = 'none';
    zmbEditingRowId = null;
}

// ----- TEST connection -----
async function testZmbConnection() {
    updateSyncLabel('Testing connection...');
    try {
        const url = buildZmbUrl();
        console.log('🔗 Test URL:', url);
        const res = await fetch(url);
        const data = await res.json();
        console.log('📊 Test response:', data);
        
        if (Array.isArray(data)) {
            if (data.length === 0) {
                alert('✅ Connected to zmbemployees sheet!\n\nFound 0 records.\nClick "Add Record" to create your first record.');
            } else {
                const firstRow = data[0];
                const keys = Object.keys(firstRow);
                const hasZmbHeaders = keys.some(k => 
                    k === 'Record Date' || k === 'Employee Name' || 
                    k === 'Start Date' || k === 'End Date'
                );
                
                if (hasZmbHeaders) {
                    alert(`✅ Connected to zmbemployees sheet!\n\nFound ${data.length} records with correct headers.`);
                } else {
                    alert(`⚠️ Data from wrong sheet.\n\nExpected: Record Date, Employee Name, Start Date, End Date\n\nFound: ${keys.join(', ')}\n\nThe zmbemployees sheet may not exist yet. Try adding a record first.`);
                }
            }
            updateSyncLabel('✓ Connected');
        } else {
            alert('⚠️ Connected but received invalid data format.');
            updateSyncLabel('⚠️ Invalid data', true);
        }
    } catch (e) {
        updateSyncLabel('❌ Failed', true);
        console.error('❌ Test error:', e);
        alert('Cannot connect to Google Sheet.\nError: ' + e.message);
    }
}

// ============================================================
//  INIT & EVENT BINDING
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Zmb page loaded');
    
    const savedUser = localStorage.getItem('zmb_currentUser');
    if (savedUser && savedUser !== 'Guest') {
        currentUser = savedUser;
        if (zmbCurrentUser) zmbCurrentUser.innerText = currentUser;
        console.log('👤 User restored:', currentUser);
    }

    const backBtn = document.getElementById('backToMainBtn');
    if (backBtn) {
        backBtn.addEventListener('click', function(e) {
            e.preventDefault();
            if (currentUser) {
                localStorage.setItem('zmb_currentUser', currentUser);
            }
            window.location.href = 'index.html?from=zmb';
        });
    }

    // Bind buttons
    const addBtn = $('zmbAddBtn');
    const refreshBtn = $('zmbRefreshBtn');
    const viewBtn = $('zmbViewBtn');
    const testBtn = $('zmbTestBtn');
    const modalClose = $('zmbModalClose');
    const closeBtn = $('zmbCloseModalBtn');
    const saveAllBtn = $('zmbSaveAllBtn');

    if (addBtn) addBtn.addEventListener('click', zmbAddNewRecord);
    if (refreshBtn) refreshBtn.addEventListener('click', loadZmbFromGoogleSheet);
    if (viewBtn) viewBtn.addEventListener('click', openZmbModal);
    if (testBtn) testBtn.addEventListener('click', testZmbConnection);
    if (modalClose) modalClose.addEventListener('click', closeZmbModal);
    if (closeBtn) closeBtn.addEventListener('click', closeZmbModal);
    if (saveAllBtn) saveAllBtn.addEventListener('click', zmbSaveAll);

    // Close modal on outside click
    if (zmbModal) {
        zmbModal.addEventListener('click', function(e) {
            if (e.target === zmbModal) closeZmbModal();
        });
    }

    // Load data on page load
    console.log('📖 Loading zmbemployees data...');
    setTimeout(() => loadZmbFromGoogleSheet(), 500);
});

// Expose functions to global scope
window.zmbAddNewRecord = zmbAddNewRecord;
window.zmbSaveAll = zmbSaveAll;
window.openZmbModal = openZmbModal;
window.closeZmbModal = closeZmbModal;
window.loadZmbFromGoogleSheet = loadZmbFromGoogleSheet;
window.testZmbConnection = testZmbConnection;
window.zmbRecalcLeaveDays = zmbRecalcLeaveDays;
window.zmbStartEdit = zmbStartEdit;
window.zmbCancelEdit = zmbCancelEdit;
window.zmbSaveEdit = zmbSaveEdit;
window.zmbDeleteRecord = zmbDeleteRecord;
