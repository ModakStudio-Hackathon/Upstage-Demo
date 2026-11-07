import { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  // LocalStorage에서 초기 데이터 불러오기 (로컬 장부 연동)
  const [receipts, setReceipts] = useState(() => {
    const saved = localStorage.getItem('modak-ledger');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  // [USER Use Case]: 지출 규정 및 예산 카테고리 설정 (모달 띄우기용 가짜 상태)
  const handleOpenSettings = () => {
    alert("지출 규정 설정 창입니다.\n(예: 식비 한도 3만원, 주류 결제 금지 등을 설정하는 화면이 들어갈 자리입니다.)");
  };

  // 장부 데이터가 변경될 때마다 LocalStorage에 자동 저장 (<<include>> 로컬 장부 자동 반영)
  useEffect(() => {
    localStorage.setItem('modak-ledger', JSON.stringify(receipts));
  }, [receipts]);

  // [USER Use Case]: 장부 내역 조회 및 카테고리별 통계 확인
  const stats = {
    totalCount: receipts.length,
    reviewCount: receipts.filter(r => r.status === '검토 필요').length,
    approvedCount: receipts.filter(r => r.status === '승인').length,
  };

  // [USER Use Case]: 영수증 사진 촬영 및 이미지 업로드
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return alert("영수증 파일을 선택해주세요.");
    setIsUploading(true);

    try {
      // 1. 영수증 텍스트 및 세부 품목 파싱 (Upstage OCR)
      const formData = new FormData();
      formData.append('document', selectedFile);

      const response = await axios.post(
        'https://api.upstage.ai/v1/document-ai/document-parse',
        formData,
        {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_UPSTAGE_API_KEY}`,
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      const parsedText = response.data.text || "";
      
      // 2 & 3. 품목별 카테고리 자동 분류 & 지출 규정 기반 1차 판정
      let status = '승인';
      let reason = '자동 승인 (규정 준수)';
      let account = '미분류';
      
      if (parsedText.includes('소주') || parsedText.includes('주류')) {
        status = '반려';
        reason = '지출 금지 품목 포함';
        account = '복리후생비 외';
      } else if (parsedText.includes('USD') || parsedText.includes('달러') || parsedText.includes('판독 불가')) {
        status = '검토 필요';
        reason = '외화 결제 또는 판독 불가 (수기 확인 필요)';
        account = '지급수수료';
      } else {
        account = parsedText.includes('식당') ? '복리후생비' : '소모품비';
      }

      const newReceipt = {
        id: Date.now(),
        date: new Date().toISOString().split('T')[0],
        merchant: selectedFile.name,
        amount: "추출된 금액", // 실제 API의 Key-Value 추출값으로 대체 필요
        account,
        status,
        reason
      };

      setReceipts([newReceipt, ...receipts]);
    } catch (error) {
      console.error(error);
      alert("문서 분석 중 오류가 발생했습니다.");
    } finally {
      setIsUploading(false);
      setSelectedFile(null);
      e.target.reset();
    }
  };

  // [USER Use Case]: '검토 필요' 항목 수기 수정 및 승인 확정
  const handleManualApprove = (id) => {
    const updated = receipts.map(item => {
      if (item.id === id) {
        return { ...item, status: '승인', reason: '관리자 수기 승인 확정' };
      }
      return item;
    });
    setReceipts(updated);
  };

  // [USER Use Case]: 장부 파일 내보내기 (CSV)
  const handleExportCSV = () => {
    if (receipts.length === 0) return alert("내보낼 데이터가 없습니다.");
    const headers = ["결제일자", "가맹점", "금액", "계정과목", "상태", "사유"];
    const csvRows = [headers.join(",")];
    
    receipts.forEach(r => {
      csvRows.push([r.date, r.merchant, r.amount, r.account, r.status, r.reason].join(","));
    });

    const blob = new Blob([csvRows.join("\n")], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "모닥스튜디오_장부.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>🏢 모닥스튜디오 재무 장부 시스템</h1>
          <p>Upstage API 기반 자동 기입 및 실무자 검수 코파일럿</p>
        </div>
        <div className="header-actions">
          <button onClick={handleOpenSettings} className="btn-secondary">⚙️ 규정 설정</button>
          <button onClick={handleExportCSV} className="btn-secondary">📥 CSV 내보내기</button>
        </div>
      </header>

      {/* 통계 대시보드 */}
      <section className="stats-dashboard">
        <div className="stat-card">총 누적 건수 <span>{stats.totalCount}건</span></div>
        <div className="stat-card warning">검토 필요 <span>{stats.reviewCount}건</span></div>
        <div className="stat-card success">승인 완료 <span>{stats.approvedCount}건</span></div>
      </section>

      <main>
        <section className="upload-section">
          <h2>영수증 / 인보이스 업로드</h2>
          <form onSubmit={handleUpload} className="upload-form">
            <input type="file" onChange={handleFileChange} accept="image/*, .pdf" className="file-input" required />
            <button type="submit" className="submit-btn" disabled={isUploading || !selectedFile}>
              {isUploading ? '문서 분석 중...' : '검수 요청하기'}
            </button>
          </form>
        </section>

        <section className="result-section">
          <h2>📊 자동 기입 장부 및 대기열</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>결제 일자</th>
                  <th>가맹점 (파일명)</th>
                  <th>금액</th>
                  <th>계정과목</th>
                  <th>판정 상태</th>
                  <th>비고 / 사유</th>
                  <th>관리자 액션</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((item) => (
                  <tr key={item.id} className={item.status === '검토 필요' ? 'row-warning' : ''}>
                    <td>{item.date}</td>
                    <td>{item.merchant}</td>
                    <td>{item.amount}</td>
                    <td><span className="account-badge">{item.account}</span></td>
                    <td>
                      <span className={`status-badge ${item.status === '승인' ? 'approved' : item.status === '반려' ? 'rejected' : 'review'}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="reason-text">{item.reason}</td>
                    <td>
                      {item.status === '검토 필요' && (
                        <button onClick={() => handleManualApprove(item.id)} className="approve-btn">
                          수기 승인
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {receipts.length === 0 && (
                  <tr><td colSpan="7" style={{textAlign: 'center', padding: '30px'}}>데이터가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;