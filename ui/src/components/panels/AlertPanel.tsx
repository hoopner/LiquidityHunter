import { useState, useEffect } from 'react';
import {
  sendTestAlert,
  getAlertSettings,
  updateAlertSettings,
  scanForAlerts,
  getAlertConditions,
  createAlertCondition,
  updateAlertCondition,
  deleteAlertCondition,
} from '../../api/client';
import type { AlertSettings, AlertCondition, SignalType } from '../../api/types';

type TabType = 'telegram' | 'ai-conditions';

/**
 * Alert settings panel for Telegram notifications and AI Signal conditions
 */
export function AlertPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('ai-conditions');

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-[var(--border-color)]">
        <button
          onClick={() => setActiveTab('ai-conditions')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'ai-conditions'
              ? 'text-[var(--accent-blue)] border-b-2 border-[var(--accent-blue)] bg-[var(--bg-tertiary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          AI 알림 조건
        </button>
        <button
          onClick={() => setActiveTab('telegram')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'telegram'
              ? 'text-[var(--accent-blue)] border-b-2 border-[var(--accent-blue)] bg-[var(--bg-tertiary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          텔레그램
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'ai-conditions' ? <AIConditionsTab /> : <TelegramTab />}
    </div>
  );
}

/**
 * AI Signal Conditions Tab
 */
function AIConditionsTab() {
  const [conditions, setConditions] = useState<AlertCondition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCondition, setEditingCondition] = useState<AlertCondition | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadConditions();
  }, []);

  const loadConditions = async () => {
    setLoading(true);
    try {
      const response = await getAlertConditions();
      setConditions(response.conditions);
    } catch (err) {
      console.error('Failed to load conditions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (conditionId: string) => {
    if (!confirm('이 알림 조건을 삭제하시겠습니까?')) return;

    try {
      await deleteAlertCondition(conditionId);
      setConditions(prev => prev.filter(c => c.id !== conditionId));
      setMessage({ type: 'success', text: '삭제되었습니다' });
    } catch (err) {
      setMessage({ type: 'error', text: '삭제 실패' });
    }
  };

  const handleToggle = async (condition: AlertCondition) => {
    try {
      const updated = await updateAlertCondition(condition.id, {
        ...condition,
        enabled: !condition.enabled,
      });
      setConditions(prev => prev.map(c => c.id === updated.id ? updated : c));
    } catch (err) {
      setMessage({ type: 'error', text: '업데이트 실패' });
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingCondition(null);
  };

  const handleFormSave = async (condition: Partial<AlertCondition>) => {
    try {
      if (editingCondition) {
        const updated = await updateAlertCondition(editingCondition.id, condition);
        setConditions(prev => prev.map(c => c.id === updated.id ? updated : c));
        setMessage({ type: 'success', text: '수정되었습니다' });
      } else {
        const created = await createAlertCondition(condition);
        setConditions(prev => [...prev, created]);
        setMessage({ type: 'success', text: '생성되었습니다' });
      }
      handleFormClose();
    } catch (err) {
      setMessage({ type: 'error', text: '저장 실패' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
        로딩중...
      </div>
    );
  }

  if (showForm) {
    return (
      <ConditionForm
        condition={editingCondition}
        onSave={handleFormSave}
        onCancel={handleFormClose}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">AI 시그널 알림</div>
            <div className="text-xs text-[var(--text-secondary)]">
              AI 합의 기반 알림 조건 설정
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 text-sm font-medium bg-[var(--accent-blue)] text-white rounded hover:opacity-90"
          >
            + 추가
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`mx-4 mt-2 p-2 rounded text-sm ${
          message.type === 'success'
            ? 'bg-[var(--accent-green)] bg-opacity-20 text-[var(--accent-green)]'
            : 'bg-[var(--accent-red)] bg-opacity-20 text-[var(--accent-red)]'
        }`}>
          {message.text}
        </div>
      )}

      {/* Conditions List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {conditions.length === 0 ? (
          <div className="text-center text-[var(--text-secondary)] py-8">
            <div className="text-4xl mb-2">🔔</div>
            <div>알림 조건이 없습니다</div>
            <div className="text-xs mt-1">+ 추가 버튼을 눌러 생성하세요</div>
          </div>
        ) : (
          conditions.map(condition => (
            <ConditionCard
              key={condition.id}
              condition={condition}
              onEdit={() => {
                setEditingCondition(condition);
                setShowForm(true);
              }}
              onDelete={() => handleDelete(condition.id)}
              onToggle={() => handleToggle(condition)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Condition Card Component
 */
function ConditionCard({
  condition,
  onEdit,
  onDelete,
  onToggle,
}: {
  condition: AlertCondition;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const signalTypeLabels: Record<SignalType, string> = {
    strong_buy: '강한 매수',
    strong_sell: '강한 매도',
    moderate_buy: '매수',
    moderate_sell: '매도',
    divergence: '의견 불일치',
    neutral: '중립',
  };

  const channelIcons = [];
  if (condition.telegram) channelIcons.push('📱');
  if (condition.in_app) channelIcons.push('🔔');
  if (condition.web_push) channelIcons.push('🌐');
  if (condition.email) channelIcons.push('📧');

  return (
    <div className={`p-3 rounded-lg border ${
      condition.enabled
        ? 'border-[var(--accent-blue)] border-opacity-50 bg-[var(--bg-secondary)]'
        : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] opacity-60'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold">
            {condition.symbol === '*' ? '모든 종목' : condition.symbol}
          </span>
          <span className="text-xs text-[var(--text-secondary)]">
            {channelIcons.join(' ')}
          </span>
        </div>
        <button
          onClick={onToggle}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            condition.enabled ? 'bg-[var(--accent-green)]' : 'bg-[var(--bg-tertiary)]'
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              condition.enabled ? 'left-5' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {/* Settings Summary */}
      <div className="text-xs text-[var(--text-secondary)] space-y-1">
        <div className="flex gap-2 flex-wrap">
          {condition.signal_types.map(type => (
            <span
              key={type}
              className={`px-1.5 py-0.5 rounded ${
                type.includes('buy')
                  ? 'bg-[var(--accent-green)] bg-opacity-20 text-[var(--accent-green)]'
                  : type.includes('sell')
                  ? 'bg-[var(--accent-red)] bg-opacity-20 text-[var(--accent-red)]'
                  : 'bg-[var(--bg-tertiary)]'
              }`}
            >
              {signalTypeLabels[type as SignalType] || type}
            </span>
          ))}
        </div>
        <div className="flex gap-3">
          <span>합의: {condition.min_consensus}/3+</span>
          <span>신뢰도: {condition.min_confidence}%+</span>
          <span>쿨다운: {condition.cooldown_minutes}분</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onEdit}
          className="px-2 py-1 text-xs text-[var(--accent-blue)] hover:bg-[var(--accent-blue)] hover:bg-opacity-10 rounded"
        >
          수정
        </button>
        <button
          onClick={onDelete}
          className="px-2 py-1 text-xs text-[var(--accent-red)] hover:bg-[var(--accent-red)] hover:bg-opacity-10 rounded"
        >
          삭제
        </button>
      </div>
    </div>
  );
}

/**
 * Condition Form Component
 */
function ConditionForm({
  condition,
  onSave,
  onCancel,
}: {
  condition: AlertCondition | null;
  onSave: (condition: Partial<AlertCondition>) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<Partial<AlertCondition>>({
    symbol: condition?.symbol || '*',
    min_confidence: condition?.min_confidence || 70,
    min_consensus: condition?.min_consensus || 2,
    require_pattern: condition?.require_pattern || false,
    signal_types: condition?.signal_types || ['strong_buy', 'strong_sell'],
    telegram: condition?.telegram ?? true,
    web_push: condition?.web_push || false,
    email: condition?.email || false,
    in_app: condition?.in_app ?? true,
    cooldown_minutes: condition?.cooldown_minutes || 30,
  });

  const signalTypeOptions: { value: SignalType; label: string }[] = [
    { value: 'strong_buy', label: '🟢 강한 매수' },
    { value: 'strong_sell', label: '🔴 강한 매도' },
    { value: 'moderate_buy', label: '📈 매수' },
    { value: 'moderate_sell', label: '📉 매도' },
    { value: 'divergence', label: '⚪ 의견 불일치' },
  ];

  const toggleSignalType = (type: SignalType) => {
    setFormData(prev => {
      const types = prev.signal_types || [];
      const newTypes = types.includes(type)
        ? types.filter(t => t !== type)
        : [...types, type];
      return { ...prev, signal_types: newTypes };
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="text-lg font-bold">
          {condition ? '알림 조건 수정' : '새 알림 조건'}
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Symbol */}
        <div>
          <label className="block text-sm font-medium mb-1">종목</label>
          <input
            type="text"
            value={formData.symbol}
            onChange={(e) => setFormData(prev => ({ ...prev, symbol: e.target.value.toUpperCase() || '*' }))}
            placeholder="* (모든 종목) 또는 종목코드"
            className="w-full px-3 py-2 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded focus:outline-none focus:border-[var(--accent-blue)]"
          />
          <div className="text-xs text-[var(--text-secondary)] mt-1">
            * 입력시 모든 종목에 적용
          </div>
        </div>

        {/* Signal Types */}
        <div>
          <label className="block text-sm font-medium mb-2">시그널 유형</label>
          <div className="flex flex-wrap gap-2">
            {signalTypeOptions.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => toggleSignalType(value)}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                  formData.signal_types?.includes(value)
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-color)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Min Consensus */}
        <div>
          <label className="block text-sm font-medium mb-1">
            최소 AI 합의도: {formData.min_consensus}/3
          </label>
          <input
            type="range"
            min={1}
            max={3}
            value={formData.min_consensus}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              min_consensus: parseInt(e.target.value),
            }))}
            className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
            <span>1/3 (낮음)</span>
            <span>2/3</span>
            <span>3/3 (전원일치)</span>
          </div>
        </div>

        {/* Min Confidence */}
        <div>
          <label className="block text-sm font-medium mb-1">
            최소 신뢰도: {formData.min_confidence}%
          </label>
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={formData.min_confidence}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              min_confidence: parseInt(e.target.value),
            }))}
            className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
            <span>50%</span>
            <span>95%</span>
          </div>
        </div>

        {/* Require Pattern */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">패턴 필수</label>
            <div className="text-xs text-[var(--text-secondary)]">
              OB 또는 FVG 정렬 필요
            </div>
          </div>
          <button
            onClick={() => setFormData(prev => ({ ...prev, require_pattern: !prev.require_pattern }))}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              formData.require_pattern ? 'bg-[var(--accent-blue)]' : 'bg-[var(--bg-tertiary)]'
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                formData.require_pattern ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>

        {/* Cooldown */}
        <div>
          <label className="block text-sm font-medium mb-1">
            알림 쿨다운: {formData.cooldown_minutes}분
          </label>
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={formData.cooldown_minutes}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              cooldown_minutes: parseInt(e.target.value),
            }))}
            className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
            <span>5분</span>
            <span>120분</span>
          </div>
        </div>

        {/* Notification Channels */}
        <div>
          <label className="block text-sm font-medium mb-2">알림 채널</label>
          <div className="space-y-2">
            {[
              { key: 'telegram', label: '📱 텔레그램', desc: 'Telegram 봇으로 알림' },
              { key: 'in_app', label: '🔔 인앱 알림', desc: '앱 내 알림센터' },
              { key: 'web_push', label: '🌐 웹 푸시', desc: '브라우저 푸시 알림' },
              { key: 'email', label: '📧 이메일', desc: '이메일로 알림' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between p-2 bg-[var(--bg-tertiary)] rounded">
                <div>
                  <div className="text-sm">{label}</div>
                  <div className="text-xs text-[var(--text-secondary)]">{desc}</div>
                </div>
                <button
                  onClick={() => setFormData(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    formData[key as keyof typeof formData] ? 'bg-[var(--accent-green)]' : 'bg-[var(--border-color)]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      formData[key as keyof typeof formData] ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-[var(--border-color)] flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 text-sm font-medium border border-[var(--border-color)] rounded hover:bg-[var(--bg-tertiary)]"
        >
          취소
        </button>
        <button
          onClick={() => onSave(formData)}
          disabled={!formData.signal_types?.length}
          className="flex-1 py-2 text-sm font-semibold bg-[var(--accent-blue)] text-white rounded hover:opacity-90 disabled:opacity-50"
        >
          저장
        </button>
      </div>
    </div>
  );
}

/**
 * Telegram Tab (Legacy)
 */
function TelegramTab() {
  const [settings, setSettings] = useState<AlertSettings>({
    enabled: true,
    min_confluence: 80,
    alert_types: ['retest'],
    cooldown_minutes: 15,
  });
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await getAlertSettings();
      setSettings(response.settings);
      setConnected(response.connected);
    } catch (err) {
      console.error('Failed to load alert settings:', err);
      setConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await updateAlertSettings(settings);
      setSettings(response.settings);
      setMessage({ type: 'success', text: '설정이 저장되었습니다' });
    } catch (err) {
      setMessage({ type: 'error', text: '설정 저장 실패' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const response = await sendTestAlert();
      if (response.success) {
        setMessage({ type: 'success', text: '테스트 알림 전송 완료!' });
        setConnected(true);
      } else {
        setMessage({ type: 'error', text: response.message });
        setConnected(false);
      }
    } catch (err) {
      setMessage({ type: 'error', text: '알림 전송 실패' });
      setConnected(false);
    } finally {
      setTesting(false);
    }
  };

  const handleScan = async (market: string) => {
    setScanning(true);
    setMessage(null);
    try {
      const response = await scanForAlerts(market);
      setMessage({
        type: 'success',
        text: `${response.scanned}개 스캔, ${response.alerts_sent}개 알림 전송`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: '스캔 실패' });
    } finally {
      setScanning(false);
    }
  };

  const toggleAlertType = (type: string) => {
    setSettings(prev => {
      const types = prev.alert_types.includes(type)
        ? prev.alert_types.filter(t => t !== type)
        : [...prev.alert_types, type];
      return { ...prev, alert_types: types };
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-secondary)] text-sm">
        로딩중...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">텔레그램 알림</div>
            <div className="text-sm text-[var(--text-secondary)]">OB/리테스트 기반</div>
          </div>
          <div className={`px-2 py-1 rounded text-xs font-medium ${
            connected
              ? 'bg-[var(--accent-green)] bg-opacity-20 text-[var(--accent-green)]'
              : 'bg-[var(--accent-red)] bg-opacity-20 text-[var(--accent-red)]'
          }`}>
            {connected ? '연결됨' : '연결 안됨'}
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">알림 활성화</label>
          <button
            onClick={() => setSettings(prev => ({ ...prev, enabled: !prev.enabled }))}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              settings.enabled ? 'bg-[var(--accent-green)]' : 'bg-[var(--bg-tertiary)]'
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                settings.enabled ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>

        {/* Min confluence */}
        <div>
          <label className="block text-sm font-medium mb-1">
            최소 컨플루언스 점수: {settings.min_confluence}
          </label>
          <input
            type="range"
            min={50}
            max={100}
            value={settings.min_confluence}
            onChange={(e) => setSettings(prev => ({
              ...prev,
              min_confluence: parseInt(e.target.value),
            }))}
            className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
            <span>50 (많음)</span>
            <span>100 (엄격)</span>
          </div>
        </div>

        {/* Cooldown */}
        <div>
          <label className="block text-sm font-medium mb-1">
            알림 쿨다운: {settings.cooldown_minutes}분
          </label>
          <input
            type="range"
            min={1}
            max={60}
            value={settings.cooldown_minutes}
            onChange={(e) => setSettings(prev => ({
              ...prev,
              cooldown_minutes: parseInt(e.target.value),
            }))}
            className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
            <span>1분</span>
            <span>60분</span>
          </div>
        </div>

        {/* Alert types */}
        <div>
          <label className="block text-sm font-medium mb-2">알림 유형</label>
          <div className="flex flex-wrap gap-2">
            {['retest', 'new_ob', 'breakout'].map(type => (
              <button
                key={type}
                onClick={() => toggleAlertType(type)}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  settings.alert_types.includes(type)
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                }`}
              >
                {type === 'retest' && 'OB 리테스트'}
                {type === 'new_ob' && '새 OB'}
                {type === 'breakout' && '돌파'}
              </button>
            ))}
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`p-2 rounded text-sm ${
            message.type === 'success'
              ? 'bg-[var(--accent-green)] bg-opacity-20 text-[var(--accent-green)]'
              : 'bg-[var(--accent-red)] bg-opacity-20 text-[var(--accent-red)]'
          }`}>
            {message.text}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-[var(--border-color)] space-y-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2 text-sm font-semibold bg-[var(--accent-blue)] text-white rounded hover:opacity-90 disabled:opacity-50"
        >
          {saving ? '저장중...' : '설정 저장'}
        </button>
        <button
          onClick={handleTest}
          disabled={testing}
          className="w-full py-2 text-sm font-semibold border border-[var(--accent-green)] text-[var(--accent-green)] rounded hover:bg-[var(--accent-green)] hover:bg-opacity-10 disabled:opacity-50"
        >
          {testing ? '전송중...' : '테스트 알림 보내기'}
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => handleScan('KR')}
            disabled={scanning}
            className="flex-1 py-2 text-sm font-medium border border-[var(--border-color)] rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            {scanning ? '...' : 'KR 스캔'}
          </button>
          <button
            onClick={() => handleScan('US')}
            disabled={scanning}
            className="flex-1 py-2 text-sm font-medium border border-[var(--border-color)] rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            {scanning ? '...' : 'US 스캔'}
          </button>
        </div>
      </div>
    </div>
  );
}
