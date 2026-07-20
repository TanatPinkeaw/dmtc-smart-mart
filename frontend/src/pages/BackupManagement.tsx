// ✅ CHANGED: JSX only — pink theme (match rest of app), Thai labels, mobile card + desktop table
// 🔒 UNCHANGED: loadBackups, handleCreateBackup, handleRestore, getStatusColor, all state/API calls
import { useState, useEffect } from 'react';
import { Database, RefreshCw, RotateCcw } from 'lucide-react';
import Swal from '../swal';
import api from '../api';

interface Backup {
  id: number;
  filename: string;
  backup_date: string;
  file_size_mb: number;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  created_at: string;
  restored_at?: string;
}

export default function BackupManagement() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLoadingBackups, setIsLoadingBackups] = useState(true);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    setIsLoadingBackups(true);
    try {
      const res = await api.get('/admin/backups');
      setBackups(res.data);
    } catch (err: any) {
      Swal.fire('Error', 'Failed to load backups', 'error');
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const handleCreateBackup = async () => {
    const confirm = await Swal.fire({
      icon: 'question',
      title: 'สำรองข้อมูลตอนนี้เลยหรือไม่?',
      text: 'ระบบจะสร้างไฟล์สำรองข้อมูลฐานข้อมูลใหม่ทันที',
      showCancelButton: true,
      confirmButtonText: 'สำรองข้อมูล',
      cancelButtonText: 'ยกเลิก',
    });

    if (!confirm.isConfirmed) return;

    setLoading(true);
    try {
      const res = await api.post('/admin/backups/create', {});
      Swal.fire({ icon: 'success', title: 'สำรองข้อมูลสำเร็จ', text: `ไฟล์: ${res.data.backup.filename}`, showConfirmButton: false, timer: 1800 });
      loadBackups();
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'สำรองข้อมูลไม่สำเร็จ', text: err.response?.data?.error || 'เกิดข้อผิดพลาด' });
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (backup: Backup) => {
    const confirmRestore = await Swal.fire({
      icon: 'warning',
      title: 'ยืนยันการกู้คืนข้อมูล',
      html: `<p>กู้คืนฐานข้อมูลจากไฟล์ <strong>${backup.filename}</strong>?</p><p class="text-red-500 font-bold mt-1">ข้อมูลปัจจุบันทั้งหมดจะถูกเขียนทับ!</p>`,
      showCancelButton: true,
      confirmButtonText: 'กู้คืนข้อมูล',
      cancelButtonText: 'ยกเลิก',
    });

    if (!confirmRestore.isConfirmed) return;

    setLoading(true);
    try {
      await api.post(`/admin/backups/${backup.id}/restore`, { confirm: true });
      Swal.fire({ icon: 'success', title: 'กู้คืนข้อมูลสำเร็จ', showConfirmButton: false, timer: 1800 });
      loadBackups();
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'กู้คืนข้อมูลไม่สำเร็จ', text: err.response?.data?.error || 'เกิดข้อผิดพลาด' });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SUCCESS':
        return 'bg-emerald-100 text-emerald-700';
      case 'FAILED':
        return 'bg-red-100 text-red-700';
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'SUCCESS': return 'สำเร็จ';
      case 'FAILED': return 'ล้มเหลว';
      case 'PENDING': return 'กำลังทำ';
      default: return status;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 bg-gradient-to-r from-brand to-brand-dark rounded-2xl shadow-md p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Database size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">สำรอง & กู้คืนข้อมูล</h1>
              <p className="text-xs text-white/80">ระบบสำรองข้อมูลอัตโนมัติทุกวัน + กดสำรองเองได้ตลอดเวลา</p>
            </div>
          </div>
          <button
            onClick={handleCreateBackup}
            disabled={loading || isLoadingBackups}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white text-brand hover:bg-brand-bg active:scale-95 px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? 'กำลังสำรองข้อมูล...' : 'สำรองข้อมูลตอนนี้'}
          </button>
        </div>

        {isLoadingBackups ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 bg-white border border-brand-border rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : backups.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl border border-brand-border text-center text-gray-400 shadow-md">
            <Database size={40} className="mx-auto mb-3 opacity-30" />
            <p>ยังไม่มีไฟล์สำรองข้อมูล</p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden space-y-3">
              {backups.map(backup => (
                <div key={backup.id} className="bg-white border border-brand-border rounded-xl p-4 shadow-md">
                  <div className="flex justify-between items-start mb-2 gap-2">
                    <p className="font-mono text-xs text-gray-700 break-all">{backup.filename}</p>
                    <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getStatusColor(backup.status)}`}>
                      {statusLabel(backup.status)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-gray-500 mb-3">
                    <span>{backup.backup_date}</span>
                    <span>{backup.file_size_mb ? `${backup.file_size_mb} MB` : '-'}</span>
                  </div>
                  <button
                    onClick={() => handleRestore(backup)}
                    disabled={loading || backup.status !== 'SUCCESS'}
                    className="w-full flex items-center justify-center gap-1.5 bg-orange-50 text-orange-700 hover:bg-orange-100 active:scale-95 py-2 rounded-lg text-sm font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCcw size={14} /> กู้คืนข้อมูล
                  </button>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block bg-white rounded-2xl border border-brand-border shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-brand-bg text-gray-600 text-sm">
                    <tr>
                      <th className="p-3 border-b">ไฟล์</th>
                      <th className="p-3 border-b">วันที่</th>
                      <th className="p-3 border-b">ขนาด</th>
                      <th className="p-3 border-b">สถานะ</th>
                      <th className="p-3 border-b">สร้างเมื่อ</th>
                      <th className="p-3 border-b text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backups.map(backup => (
                      <tr key={backup.id} className="border-b last:border-0 hover:bg-brand-bg transition-colors">
                        <td className="p-3 font-mono text-xs text-gray-700">{backup.filename}</td>
                        <td className="p-3 text-sm text-gray-600">{backup.backup_date}</td>
                        <td className="p-3 text-sm text-gray-600">{backup.file_size_mb ? `${backup.file_size_mb} MB` : '-'}</td>
                        <td className="p-3">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${getStatusColor(backup.status)}`}>
                            {statusLabel(backup.status)}
                          </span>
                        </td>
                        <td className="p-3 text-sm text-gray-600">{new Date(backup.created_at).toLocaleString('th-TH')}</td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleRestore(backup)}
                            disabled={loading || backup.status !== 'SUCCESS'}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-700 hover:bg-orange-100 active:scale-95 rounded-lg text-sm font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
                            title={backup.status !== 'SUCCESS' ? 'กู้คืนได้เฉพาะไฟล์ที่สำรองสำเร็จ' : ''}
                          >
                            <RotateCcw size={14} /> กู้คืน
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
