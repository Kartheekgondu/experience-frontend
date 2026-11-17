import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { jsPDF } from 'jspdf';
import './style.css';

const API = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:9090').replace(/\/$/, '');
const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const emptyForm = { name: '', employeeId: '', designation: '', letterDate: getToday(), doj: '', lastWorkingDate: '', email: '' };
// Reject five or more consecutive copies of the same character, case-insensitively.
const hasRepeatedRun = (value) => /(.)\1{4,}/iu.test(String(value ?? ''));

function App() {
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState('');
  const [history, setHistory] = useState([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [letter, setLetter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchedForId, setFetchedForId] = useState('');
  const [previousLetter, setPreviousLetter] = useState(null);

  // Keep every field in the original form. Changing the Employee ID clears old
  // employee values so details from a previous employee can never be reused.
  // Normalize text as the user types: no leading whitespace and never
  // more than one space between words. Name/designation use title case.
  const normalizeText = (field, rawValue) => {
    let value = String(rawValue ?? '');
    if (field === 'employeeId') {
      // Employee IDs: letters and numbers only, always uppercase.
      return value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 50).toUpperCase();
    }
    if (field === 'email') {
      // Email accepts only letters, numbers, @ and dot; no whitespace or other symbols.
      return value.replace(/[^a-zA-Z0-9@.]/g, '').slice(0, 50);
    }
    if (field === 'name' || field === 'designation') {
      // Names/designations accept letters and single spaces only.
      value = value.replace(/[^\p{L} ]/gu, '').replace(/\s+/g, ' ').replace(/^ /, '').slice(0, 50);
      return value.toLocaleLowerCase().replace(/(^| )(\p{L})/gu, (_, boundary, letter) => boundary + letter.toLocaleUpperCase());
    }
    return value.slice(0, 50);
  };

  const update = (event) => {
    const { name, value: rawValue } = event.target;
    const value = ['name', 'employeeId', 'designation', 'email'].includes(name)
      ? normalizeText(name, rawValue)
      : rawValue;
    if (hasRepeatedRun(value)) {
      const fieldLabel = ({ name: 'Full Name', employeeId: 'Employee ID', designation: 'Designation',
        letterDate: 'Letter Date', doj: 'Date of Joining', lastWorkingDate: 'Last Working Date',
        email: 'Recipient Email' })[name] || 'This field';
      setStatus(`${fieldLabel} cannot contain the same character 5 or more times in a row.`);
      return;
    }
    if (name === 'employeeId') {
      setForm(current => ({ ...emptyForm, employeeId: value, letterDate: current.letterDate || getToday() }));
      setFetchedForId('');
      setLetter(false);
      setHistory([]);
      setHistoryVisible(false);
      setPreviousLetter(null);
      setStatus(value.length >= 3 ? 'Searching for employee details and previous letters...' : 'Enter the previous Employee ID. Details and saved letters will load automatically.');
      return;
    }
    setForm(current => ({ ...current, [name]: value }));
  };

  const lookupEmployee = async (idValue = form.employeeId, isCurrent = () => true) => {
    const id = String(idValue || '').trim().toUpperCase();
    if (!id) return false;
    if (hasRepeatedRun(id)) {
      setStatus('Employee ID cannot contain the same character 5 or more times in a row.');
      return false;
    }
    setLoading(true);
    setStatus(`Fetching details for ${id}...`);
    try {
      const response = await fetch(`${API}/api/employee/${encodeURIComponent(id)}`);
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
      if (!isCurrent()) return false;
      if (response.status === 404) {
        setFetchedForId('');
        setLetter(false);
        setStatus(data.error || `No employee or previous letter found for Employee ID ${id}.`);
        return false;
      }
      if (!response.ok) throw new Error(data.error || data.message || `Lookup failed (HTTP ${response.status})`);
      setForm(current => ({
        ...current,
        employeeId: normalizeText('employeeId', id),
        name: normalizeText('name', data.full_name || data.fullName || data.employeeName || ''),
        designation: normalizeText('designation', data.designation || data.role || ''),
        letterDate: getToday(),
        doj: (data.join_date || data.joinDate || data.date_of_joining || data.dateOfJoining) ? String(data.join_date || data.joinDate || data.date_of_joining || data.dateOfJoining).slice(0, 10) : '',
        lastWorkingDate: (data.last_working_date || data.lastWorkingDate) ? String(data.last_working_date || data.lastWorkingDate).slice(0, 10) : '',
        email: normalizeText('email', data.email || data.recipient_email || data.recipientEmail || '')
      }));
      setFetchedForId(id);
      const hasRequiredDetails = Boolean((data.full_name || data.fullName || data.employeeName) && (data.designation || data.role) && (data.join_date || data.joinDate || data.date_of_joining || data.dateOfJoining) && (data.last_working_date || data.lastWorkingDate) && (data.email || data.recipient_email || data.recipientEmail));
      setLetter(hasRequiredDetails);
      setStatus(hasRequiredDetails
        ? `Employee details fetched for ${id}. Your experience letter preview is ready.`
        : `Employee ${id} was found, but some details are missing. Complete the empty fields and click Generate Letter.`);
      return true;
    } catch (error) {
      if (isCurrent()) setStatus(`Employee lookup failed: ${error.message}. Check that Spring Boot is running at ${API}.`);
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const validate = () => {
    // Every field must contain at least one meaningful value. This rejects
    // empty strings and whitespace-only values before any letter action.
    const requiredFields = [
      ['Full Name', form.name],
      ['Employee ID', form.employeeId],
      ['Designation', form.designation],
      ['Letter Date', form.letterDate],
      ['Date of Joining', form.doj],
      ['Last Working Date', form.lastWorkingDate],
      ['Recipient Email', form.email]
    ];
    const emptyField = requiredFields.find(([, value]) => !String(value ?? '').trim());
    if (emptyField) return `${emptyField[0]} is required. Enter at least one character or select a valid date.`;
    const repeatedField = requiredFields.find(([, value]) => hasRepeatedRun(value));
    if (repeatedField) return `${repeatedField[0]} cannot contain the same character 5 or more times in a row.`;
    if (Object.values(form).some(value => String(value ?? '').length > 50)) return 'Every field must contain no more than 50 characters.';
    if (!/^[\p{L}]+(?: [\p{L}]+)*$/u.test(form.name.trim())) return 'Full Name must contain letters and single spaces only.';
    if (!/^[A-Z0-9]{1,50}$/.test(form.employeeId)) return 'Employee ID must contain letters and numbers only (maximum 50 characters).';
    if (!/^[\p{L}]+(?: [\p{L}]+)*$/u.test(form.designation.trim())) return 'Designation must contain letters and single spaces only.';
    if (form.doj >= form.lastWorkingDate) return 'Last working date must be after date of joining.';
    if (form.letterDate <= form.lastWorkingDate || form.letterDate > getToday()) return 'Letter date must be after last working date and cannot be in the future.';
    if (!/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*@[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$/.test(form.email)) return 'Enter a valid recipient email address.';
    return '';
  };

  const generate = async () => {
    const employeeId = String(form.employeeId || '').trim().toUpperCase();
    if (!employeeId) { setStatus('Please enter an Employee ID.'); return; }

    // Do not trigger a lookup on input blur: that can disable the button
    // between pointer-down and click. Lookup is performed only after the
    // Generate button has actually been activated.
    if (fetchedForId !== employeeId) {
      const found = await lookupEmployee(employeeId);
      if (found) {
        // A complete database record opens the preview in lookupEmployee.
        // If some values are missing, the user can complete them and click again.
        setStatus('Employee lookup completed. Review the populated fields, complete any missing details, then click Generate Letter again.');
        return;
      }

      // Keep manual generation available if the employee record is not in
      // the live database but the user has supplied every required field.
      const manualError = validate();
      if (!manualError) {
        setLetter(true);
        setStatus('Letter preview generated from the details entered manually.');
      }
      return;
    }

    const error = validate();
    if (error) { setStatus(error); return; }
    setLetter(true);
    setStatus('Experience letter preview generated.');
  };

  const makePdf = () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('UXINTERFACELY IT SOLUTIONS LLP', 105, 25, { align: 'center' });
    doc.setFontSize(14); doc.text('EXPERIENCE LETTER', 105, 48, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    const lines = [
      `Date: ${form.letterDate}`, '', 'To Whom It May Concern,', '',
      `This is to certify that ${form.name} (Employee ID: ${form.employeeId}) was employed with UXINTERFACELY IT SOLUTIONS LLP as ${form.designation} from ${form.doj} to ${form.lastWorkingDate}.`, '',
      'During the period of employment, the employee performed the assigned responsibilities.',
      'We appreciate the contributions and wish continued success in future endeavors.', '',
      'Best Regards,', 'Human Resources', 'UXINTERFACELY IT SOLUTIONS LLP'
    ];
    let y = 65;
    lines.forEach(line => { const wrapped = doc.splitTextToSize(line, 165); doc.text(wrapped, 22, y); y += wrapped.length * 6 + 4; });
    return doc;
  };

  const download = () => {
    const error = validate(); if (error) { setStatus(error); return; }
    makePdf().save(`${form.employeeId}_Experience_Letter.pdf`);
  };

  const loadHistory = async (id = form.employeeId, isCurrent = () => true) => {
    const employeeId = String(id || '').trim().toUpperCase();
    if (!employeeId) {
      setHistory([]);
      setHistoryVisible(true);
      setStatus('Please enter an Employee ID before finding letter history.');
      return;
    }
    setHistoryVisible(true);
    setHistoryLoading(true);
    setHistory([]);
    try {
      const response = await fetch(`${API}/api/experience-history/${encodeURIComponent(employeeId)}`);
      const raw = await response.text();
      let rows = [];
      try { rows = raw ? JSON.parse(raw) : []; } catch { rows = []; }
      if (!response.ok) {
        const message = rows.error || rows.message || `Could not load history (HTTP ${response.status})`;
        throw new Error(message);
      }
      if (!isCurrent()) return;
      const records = Array.isArray(rows) ? rows : [];
      setHistory(records);
      setPreviousLetter(records.find(item => item.pdf_path) || null);
      setStatus(records.length
        ? `Found ${records.length} previous letter${records.length === 1 ? '' : 's'} for ${employeeId}.`
        : `No previous letters found for Employee ID ${employeeId}.`);
    } catch (error) {
      if (isCurrent()) {
        setHistory([]);
        setPreviousLetter(null);
        setStatus(`Letter history error: ${error.message}. Check that Spring Boot is running at ${API}.`);
      }
    } finally {
      if (isCurrent()) setHistoryLoading(false);
    }
  };

  // Automatically fetch employee details and previous letter history after the
  // user pauses typing. The debounce prevents a request for every keystroke.
  useEffect(() => {
    const employeeId = String(form.employeeId || '').trim().toUpperCase();
    if (employeeId.length < 3) return undefined;
    let cancelled = false;
    const isCurrent = () => !cancelled;
    const timer = setTimeout(async () => {
      await lookupEmployee(employeeId, isCurrent);
      if (isCurrent()) await loadHistory(employeeId, isCurrent);
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.employeeId]);

  const formatHistoryDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };

  const uploadPdf = async (endpoint) => {
    const error = validate(); if (error) { setStatus(error); return; }
    const blob = makePdf().output('blob');
    const data = new FormData();
    data.append('pdf', blob, `${form.employeeId}_experience_letter.pdf`);
    Object.entries({ employeeName: form.name, employeeId: form.employeeId, designation: form.designation,
      recipientEmail: form.email, doj: form.doj, lastWorkingDate: form.lastWorkingDate, letterDate: form.letterDate
    }).forEach(([key, value]) => data.append(key, value));
    setLoading(true);
    setStatus(endpoint === 'send-experience' ? 'Sending email...' : 'Saving letter...');
    try {
      const response = await fetch(`${API}/api/${endpoint}`, { method: 'POST', body: data });
      const raw = await response.text();
      let result = {}; try { result = raw ? JSON.parse(raw) : {}; } catch { result = { error: raw }; }
      if (!response.ok) throw new Error(result.error || result.message || `Request failed (HTTP ${response.status})`);
      setStatus(endpoint === 'send-experience' ? `Experience letter emailed successfully to ${form.email}.` : 'Experience letter saved successfully.');
      if (historyVisible) await loadHistory(form.employeeId);
    } catch (error) {
      setStatus(`Could not ${endpoint === 'send-experience' ? 'send email' : 'save letter'}: ${error.message}`);
    } finally { setLoading(false); }
  };

  const openPdf = async (path) => {
    try {
      const response = await fetch(`${API}/api/experience-pdf-url?path=${encodeURIComponent(path)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to open PDF');
      window.open(result.url.startsWith('http') ? result.url : `${API}${result.url}`, '_blank', 'noopener,noreferrer');
    } catch (error) { setStatus(error.message); }
  };

  const fields = [
    ['name', 'Full Name', 'text'], ['employeeId', 'Employee ID', 'text'],
    ['designation', 'Designation', 'text'], ['letterDate', 'Letter Date', 'date'],
    ['doj', 'Date of Joining', 'date'], ['lastWorkingDate', 'Last Working Date', 'date'],
    ['email', 'Recipient Email', 'email']
  ];

  return <main className="shell">
    <header><img src="/logo.png" alt="UXInterfacely logo" /><div><h1>Experience Letter Generator</h1><p>Generate, review, download and send employee experience letters</p></div></header>
    <section className="panel">
      <h2>Employee Details</h2>
      <div className="grid">
        {fields.map(([name, label, type]) => <label key={name}>{label}
          <input name={name} type={type} value={form[name]} onChange={update}
            minLength={['name', 'employeeId', 'designation', 'email'].includes(name) ? 1 : undefined}
            maxLength={50} max={name === 'letterDate' ? getToday() : undefined}
            pattern={name === 'employeeId' ? '[A-Z0-9]{1,50}' : undefined}
            title={name === 'employeeId' ? 'Use capital letters (A-Z) and numbers (0-9) only.' : undefined}
            autoCapitalize={name === 'employeeId' ? 'characters' : undefined}
            autoComplete={name === 'email' ? 'email' : 'off'} required />
        </label>)}
      </div>
      <div className="actions">
        <button type="button" onClick={generate}>Generate Letter</button>
        <button className="secondary" onClick={() => loadHistory()} disabled={loading || historyLoading}>{historyLoading ? 'Searching...' : 'Find Letter History'}</button>
      </div>
    </section>
    {letter && <section className="letter">
      <div className="letter-tools">
        <button className="secondary" onClick={() => setEditing(!editing)}>{editing ? 'Finish Editing' : 'Edit Letter'}</button>
        <button onClick={download}>Download PDF</button>
        <button onClick={() => uploadPdf('save-experience')} disabled={loading}>Save Letter</button>
        <button onClick={() => uploadPdf('send-experience')} disabled={loading}>Email Letter</button>
      </div>
      <article contentEditable={editing} suppressContentEditableWarning>
        <h2>EXPERIENCE LETTER</h2>
        <p className="right">Date: {form.letterDate}</p>
        <p>To Whom It May Concern,</p>
        <p>This is to certify that <b>{form.name}</b> (Employee ID: <b>{form.employeeId}</b>) was employed with <b>UXINTERFACELY IT SOLUTIONS LLP</b> as <b>{form.designation}</b> from <b>{form.doj}</b> to <b>{form.lastWorkingDate}</b>.</p>
        <p>During the period of employment, the employee performed the assigned responsibilities. We appreciate the contributions and wish continued success in future endeavors.</p>
        <p>Best Regards,</p><p><b>Human Resources</b><br />UXINTERFACELY IT SOLUTIONS LLP</p>
        <img className="signature" src="/signature.png" alt="Authorized signature" />
      </article>
    </section>}
    {historyVisible && <section className="panel history-panel">
      <div className="history-heading">
        <h2>Letter History — {form.employeeId || 'Employee'}</h2>
        <button className="secondary" onClick={() => { setHistoryVisible(false); setHistory([]); }}>Close</button>
      </div>
      {historyLoading ? <p>Searching previous letters...</p> : history.length > 0 ? <>
        {previousLetter?.pdf_path && <div className="previous-letter-preview">
          <h3>Latest Previous Experience Letter</h3>
          <iframe title="Previous experience letter" src={`${API}/api/experience-pdf?path=${encodeURIComponent(previousLetter.pdf_path)}`} />
          <button className="secondary" type="button" onClick={() => openPdf(previousLetter.pdf_path)}>Open PDF in new tab</button>
        </div>}
        {history.map((item, index) => <div className="history" key={item.id || index}>
          <span>{item.employee_name || form.name || item.employee_id} · {item.status} · {formatHistoryDate(item.created_at)}</span>
          {item.pdf_path ? <button className="secondary" onClick={() => { setPreviousLetter(item); }} type="button">Display this letter</button> : <span>No PDF available</span>}
        </div>)}
      </> : <p>No previous letters found for this Employee ID.</p>}
    </section>}
    {status && <p className="status" role="status">{status}</p>}
    <footer>UXINTERFACELY IT SOLUTIONS LLP</footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
