import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const CACHE_KEY = 'modak-ledger-v2';
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 10;

function getCachedReceipts() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || localStorage.getItem('modak-ledger') || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

function firstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return undefined;
}

function toDateTimeLocal(value) {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  const input = String(value).trim();
  const koreanDate = input.match(/(\d{4})\s*[년./-]\s*(\d{1,2})\s*[월./-]\s*(\d{1,2})/);
  if (koreanDate) {
    const [, year, month, day] = koreanDate;
    const time = input.match(/(\d{1,2}):(\d{2})/);
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${(time?.[1] || '00').padStart(2, '0')}:${time?.[2] || '00'}`;
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return '';
  const localDate = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function toAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.round(value));
  if (value === undefined || value === null) return '';
  const parsed = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? String(Math.round(parsed)) : '';
}

function toReviewStatus(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['false', 'approved', 'approve', '승인', '검토 완료', '불필요'].includes(normalized)) return false;
  return true;
}

function normalizeAnalysis(result, filename) {
  const nested = result?.receipt ?? result?.data ?? result?.extracted_data ?? result;
  const source = Array.isArray(nested) ? nested[0] ?? {} : nested ?? {};
  const statusValue = firstValue(source, ['review_status', 'needs_review', 'status', '판정 상태']);
  return {
    payment_date: toDateTimeLocal(firstValue(source, [
      'payment_date', 'paymentDate', 'date', 'transaction_date', '결제일자', '결제 일자', '거래일자', '거래 일시',
    ])),
    merchant_file: String(firstValue(source, [
      'merchant_file', 'merchant', 'merchant_name', 'store_name', 'business_name', '가맹점', '상호', '상호명', '매장명',
    ]) ?? filename),
    amount: toAmount(firstValue(source, [
      'amount', 'total_amount', 'total', 'payment_amount', '결제금액', '결제 금액', '총액', '합계',
    ])),
    account_category: String(firstValue(source, [
      'account_category', 'account', 'category', 'account_name', '계정과목', '비용 항목',
    ]) ?? '미분류'),
    review_status: toReviewStatus(statusValue),
    reason: String(firstValue(source, ['reason', 'review_reason', 'note', '사유', '비고']) ?? 'AI 분석 결과를 확인해 주세요.'),
  };
}

function receiptFromApi(receipt) {
  const reviewStatus = Boolean(receipt.review_status);
  return {
    id: receipt.id,
    serverId: receipt.id,
    date: receipt.payment_date,
    merchant: receipt.merchant_file,
    amount: receipt.amount,
    account: receipt.account_category,
    status: reviewStatus ? '검토 필요' : '승인',
    reason: receipt.reason || '',
  };
}

function formatDate(value) {
  if (!value) return '날짜 미확인';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ko-KR');
}

function formatAmount(value) {
  if (value === undefined || value === null || value === '') return '금액 미확인';
  const amount = Number(value);
  return Number.isFinite(amount) ? `${new Intl.NumberFormat('ko-KR').format(amount)}원` : String(value);
}

function errorMessage(error) {
  return error.response?.data?.detail || error.message || '요청을 처리하지 못했습니다.';
}

function isDraftReady(draft) {
  return Boolean(
    draft
      && draft.payment_date
      && draft.merchant_file.trim()
      && draft.amount !== ''
      && Number.isInteger(Number(draft.amount))
      && draft.account_category.trim(),
  );
}

function App() {
  const [receipts, setReceipts] = useState(getCachedReceipts);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [analysisDrafts, setAnalysisDrafts] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [savingDraftId, setSavingDraftId] = useState(null);
  const [savingReceiptId, setSavingReceiptId] = useState(null);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/receipts`)
      .then(({ data }) => {
        if (!active) return;
        setReceipts(Array.isArray(data) ? data.map(receiptFromApi) : []);
        setApiConnected(true);
        setError('');
      })
      .catch(() => {
        if (!active) return;
        setApiConnected(false);
        setError('백엔드에 연결하지 못했습니다. 서버가 실행 중인지 확인해 주세요.');
      })
      .finally(() => {
        if (active) setIsLoadingReceipts(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(receipts));
    } catch {
      // The API remains the source of truth if browser storage is unavailable.
    }
  }, [receipts]);

  const stats = {
    totalCount: receipts.length,
    reviewCount: receipts.filter((receipt) => receipt.status === '검토 필요').length,
    approvedCount: receipts.filter((receipt) => receipt.status === '승인').length,
  };
  const handleFileChange = (event) => {
    const files = Array.from(event.target.files ?? []);
    setSelectedFiles(files.slice(0, MAX_FILES));
    setAnalysisDrafts([]);
    setError(files.length > MAX_FILES ? `한 번에 최대 ${MAX_FILES}장까지 선택할 수 있습니다.` : '');
  };

  const handleAnalyze = async (event) => {
    event.preventDefault();
    if (selectedFiles.length === 0) {
      setError('영수증 사진을 선택해 주세요.');
      return;
    }
    const invalidFile = selectedFiles.find((file) => !file.type.startsWith('image/'));
    if (invalidFile) {
      setError(`${invalidFile.name}: JPG, PNG 등 이미지 파일을 선택해 주세요.`);
      return;
    }
    const oversizedFile = selectedFiles.find((file) => file.size > MAX_IMAGE_SIZE);
    if (oversizedFile) {
      setError(`${oversizedFile.name}: 이미지는 10MB 이하로 업로드해 주세요.`);
      return;
    }

    setIsUploading(true);
    setError('');
    setAnalysisDrafts([]);
    const completedDrafts = [];
    setUploadProgress({ current: 0, total: selectedFiles.length });

    for (const [index, file] of selectedFiles.entries()) {
      setUploadProgress({ current: index + 1, total: selectedFiles.length });
      const formData = new FormData();
      formData.append('file', file);
      const id = `${Date.now()}-${index}`;

      try {
        const { data } = await axios.post(`${API_BASE_URL}/receipts/analyze`, formData);
        completedDrafts.push({
          id,
          filename: file.name,
          rawResult: data,
          ...normalizeAnalysis(data, file.name),
        });
        setApiConnected(true);
      } catch (requestError) {
        completedDrafts.push({
          id,
          filename: file.name,
          error: errorMessage(requestError),
        });
      }
      setAnalysisDrafts([...completedDrafts]);
    }
    setIsUploading(false);
  };

  const updateDraft = (id, field, value) => {
    setAnalysisDrafts((drafts) => drafts.map((draft) => (
      draft.id === id ? { ...draft, [field]: value } : draft
    )));
  };

  const handleSaveReceipt = async (event, draft) => {
    event.preventDefault();
    if (!isDraftReady(draft)) {
      setError('결제일, 가맹점, 금액, 계정과목을 확인해 주세요.');
      return;
    }
    setSavingDraftId(draft.id);
    setError('');
    const payload = {
      payment_date: draft.payment_date,
      merchant_file: draft.merchant_file.trim(),
      amount: Number(draft.amount),
      account_category: draft.account_category.trim(),
      review_status: draft.review_status,
      reason: draft.reason.trim() || null,
    };
    try {
      const { data } = await axios.post(`${API_BASE_URL}/receipts`, payload);
      setReceipts((current) => [receiptFromApi(data), ...current]);
      const remainingDrafts = analysisDrafts.filter((item) => item.id !== draft.id);
      setAnalysisDrafts(remainingDrafts);
      if (remainingDrafts.length === 0) {
        setSelectedFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      setApiConnected(true);
    } catch (requestError) {
      setError(`장부 저장에 실패했습니다. ${errorMessage(requestError)}`);
    } finally {
      setSavingDraftId(null);
    }
  };

  const handleManualApprove = async (receipt) => {
    if (!receipt.serverId) {
      setError('백엔드에 저장된 항목만 승인할 수 있습니다.');
      return;
    }
    setSavingReceiptId(receipt.id);
    setError('');
    try {
      const { data } = await axios.patch(`${API_BASE_URL}/receipts/${receipt.serverId}`, {
        review_status: false,
        reason: '관리자 수기 승인 확정',
      });
      setReceipts((current) => current.map((item) => (
        item.id === receipt.id ? receiptFromApi(data) : item
      )));
    } catch (requestError) {
      setError(`승인 처리에 실패했습니다. ${errorMessage(requestError)}`);
    } finally {
      setSavingReceiptId(null);
    }
  };

  const handleExportCSV = () => {
    if (receipts.length === 0) {
      setError('내보낼 데이터가 없습니다.');
      return;
    }
    const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = [
      ['결제일자', '가맹점', '금액', '계정과목', '상태', '사유'],
      ...receipts.map((receipt) => [
        formatDate(receipt.date), receipt.merchant, receipt.amount,
        receipt.account, receipt.status, receipt.reason,
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '모닥스튜디오_장부.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="모닥 장부 홈">
          <span className="brand-mark">M</span>
          <span>모닥 <strong>장부</strong></span>
        </a>
        <div className={`api-status ${apiConnected ? 'is-connected' : 'is-disconnected'}`}>
          <span className="status-dot" />
          {apiConnected ? '백엔드 연결됨' : isLoadingReceipts ? '백엔드 연결 확인 중' : '백엔드 연결 오류'}
        </div>
      </header>

      <main className="page-content">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">RECEIPT LEDGER</p>
            <h1>영수증을 올리면<br />장부가 채워집니다.</h1>
            <p className="hero-description">AI가 결제 정보를 읽고, 확인이 필요한 항목은 직접 검토한 뒤 저장할 수 있어요.</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="receipt-paper">
              <span className="paper-line paper-line-short" />
              <span className="paper-line" />
              <span className="paper-line" />
              <span className="paper-dash" />
              <span className="paper-total" />
            </div>
            <span className="sparkle sparkle-one">✦</span>
            <span className="sparkle sparkle-two">✦</span>
          </div>
        </section>

        <section className="stats-grid" aria-label="장부 요약">
          <article className="stat-card">
            <span className="stat-label">누적 영수증</span>
            <strong>{stats.totalCount}<small>건</small></strong>
          </article>
          <article className="stat-card stat-review">
            <span className="stat-label">검토 대기</span>
            <strong>{stats.reviewCount}<small>건</small></strong>
          </article>
          <article className="stat-card stat-approved">
            <span className="stat-label">확인 완료</span>
            <strong>{stats.approvedCount}<small>건</small></strong>
          </article>
        </section>

        <section className="panel upload-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">NEW ENTRY</p>
              <h2>영수증 분석</h2>
            </div>
            <span className="step-pill">사진 업로드 · AI 분석 · 확인 후 저장</span>
          </div>
          <form className="upload-form" onSubmit={handleAnalyze}>
            <label className="upload-dropzone" htmlFor="receipt-file">
              <span className="upload-icon" aria-hidden="true">↑</span>
              <span className="upload-copy">
                <strong>{selectedFiles.length ? `${selectedFiles.length}장 선택됨` : '영수증 사진을 선택하세요'}</strong>
                <small className="selected-file-names">
                  {selectedFiles.length
                    ? selectedFiles.map((file) => file.name).join(', ')
                    : `JPG, PNG, HEIC · 파일당 최대 10MB · 한 번에 최대 ${MAX_FILES}장`}
                </small>
              </span>
              <span className="choose-file">파일 선택</span>
              <input
                ref={fileInputRef}
                id="receipt-file"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                disabled={isUploading}
              />
            </label>
            <button type="submit" className="primary-button" disabled={isUploading || selectedFiles.length === 0}>
              {isUploading
                ? <><span className="spinner" />분석 중 {uploadProgress.current}/{uploadProgress.total}</>
                : selectedFiles.length ? `${selectedFiles.length}장 AI 분석하기` : 'AI로 분석하기'}
            </button>
          </form>
          <p className="privacy-note">사진은 한 장씩 백엔드와 Upstage AI로 전송됩니다. 분석 결과는 각각 확인 후 저장할 수 있습니다.</p>
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <span aria-hidden="true">!</span>
            <p>{error}</p>
            <button type="button" onClick={() => setError('')} aria-label="오류 메시지 닫기">×</button>
          </div>
        )}

        {analysisDrafts.length > 0 && (
          <section className="panel draft-panel">
            <div className="section-heading draft-heading">
              <div>
                <p className="eyebrow">AI EXTRACTION</p>
                <h2>분석 결과 {analysisDrafts.length}건</h2>
              </div>
            </div>
            <p className="draft-help">각 항목을 확인하고 저장하세요. 한 파일의 분석이 실패해도 나머지 결과는 계속 표시됩니다.</p>
            <div className="draft-list">
              {analysisDrafts.map((draft) => (
                <article className={`draft-item ${draft.error ? 'draft-item-error' : ''}`} key={draft.id}>
                  <div className="draft-file-heading">
                    <div className="draft-file-name">
                      <span className="file-mark">▧</span>
                      <div>
                        <span className="file-label">영수증 사진</span>
                        <h3 title={draft.filename}>{draft.filename}</h3>
                      </div>
                    </div>
                    {draft.error
                      ? <span className="failed-chip">분석 실패</span>
                      : <span className={draft.review_status ? 'review-chip' : 'approved-chip'}>{draft.review_status ? '검토 필요' : '승인'}</span>}
                  </div>
                  {draft.error ? (
                    <p className="draft-error-message">{draft.error}</p>
                  ) : (
                    <>
                      <form className="draft-form" onSubmit={(event) => handleSaveReceipt(event, draft)}>
                        <label>
                          <span>결제 일시</span>
                          <input type="datetime-local" value={draft.payment_date} onChange={(event) => updateDraft(draft.id, 'payment_date', event.target.value)} required />
                        </label>
                        <label>
                          <span>가맹점</span>
                          <input type="text" value={draft.merchant_file} onChange={(event) => updateDraft(draft.id, 'merchant_file', event.target.value)} required />
                        </label>
                        <label>
                          <span>결제 금액</span>
                          <div className="amount-input-wrap">
                            <input type="number" min="0" step="1" value={draft.amount} onChange={(event) => updateDraft(draft.id, 'amount', event.target.value)} placeholder="금액 입력" required />
                            <span>원</span>
                          </div>
                        </label>
                        <label>
                          <span>계정과목</span>
                          <input type="text" value={draft.account_category} onChange={(event) => updateDraft(draft.id, 'account_category', event.target.value)} placeholder="예: 복리후생비" required />
                        </label>
                        <label className="draft-reason">
                          <span>검토 메모</span>
                          <textarea rows="2" value={draft.reason} onChange={(event) => updateDraft(draft.id, 'reason', event.target.value)} placeholder="필요한 내용을 입력하세요" />
                        </label>
                        <label className="review-toggle">
                          <input type="checkbox" checked={draft.review_status} onChange={(event) => updateDraft(draft.id, 'review_status', event.target.checked)} />
                          담당자 검토가 필요합니다
                        </label>
                        <div className="draft-actions">
                          <span className="draft-save-hint">저장 후 장부 내역에 추가됩니다.</span>
                          <button type="submit" className="primary-button" disabled={isUploading || savingDraftId !== null || !isDraftReady(draft)}>
                            {savingDraftId === draft.id ? '저장 중…' : '확인하고 저장'}
                          </button>
                        </div>
                      </form>
                      <details className="raw-result">
                        <summary>AI 원본 응답 보기</summary>
                        <pre>{JSON.stringify(draft.rawResult, null, 2)}</pre>
                      </details>
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="panel ledger-panel">
          <div className="section-heading ledger-heading">
            <div>
              <p className="eyebrow">LEDGER</p>
              <h2>장부 내역</h2>
            </div>
            <button type="button" className="secondary-button" onClick={handleExportCSV}>↓ CSV 내보내기</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>결제 일자</th>
                  <th>가맹점</th>
                  <th>금액</th>
                  <th>계정과목</th>
                  <th>상태</th>
                  <th>검토 메모</th>
                  <th aria-label="작업" />
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.id} className={receipt.status === '검토 필요' ? 'needs-review-row' : ''}>
                    <td>{formatDate(receipt.date)}</td>
                    <td className="merchant-cell">{receipt.merchant || '가맹점 미확인'}</td>
                    <td className="amount-cell">{formatAmount(receipt.amount)}</td>
                    <td><span className="category-tag">{receipt.account || '미분류'}</span></td>
                    <td>
                      <span className={`status-tag ${receipt.status === '승인' ? 'status-approved' : receipt.status === '반려' ? 'status-rejected' : 'status-review'}`}>
                        <span />{receipt.status}
                      </span>
                    </td>
                    <td className="reason-cell">{receipt.reason || '—'}</td>
                    <td>
                      {receipt.status === '검토 필요' && (
                        <button
                          type="button"
                          className="approve-button"
                          onClick={() => handleManualApprove(receipt)}
                          disabled={!receipt.serverId || savingReceiptId === receipt.id}
                        >
                          {savingReceiptId === receipt.id ? '처리 중…' : '승인'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {receipts.length === 0 && (
                  <tr>
                    <td className="empty-state" colSpan="7">
                      <span className="empty-icon">▤</span>
                      <strong>{isLoadingReceipts ? '장부를 불러오는 중입니다' : '아직 등록된 영수증이 없습니다'}</strong>
                      <small>영수증 사진을 분석해 첫 장부 항목을 만들어 보세요.</small>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <footer className="page-footer">모닥 장부 · 영수증 데이터는 연결된 백엔드에 저장됩니다.</footer>
      </main>
    </div>
  );
}

export default App;
