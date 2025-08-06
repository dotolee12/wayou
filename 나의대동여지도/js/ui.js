// js/ui.js - UI 업데이트 및 이벤트 핸들러

class UIManager {
    constructor() {
        this.elements = {};
        this.feedbackTimeout = null;
        this.statsTimeout = null;
        
        // Throttle된 업데이트 함수들
        this.updateUI = Utils.throttle(this._updateUI.bind(this), 500);
        this.updateStats = Utils.throttle(this._updateStats.bind(this), 1000);
        this.showFeedback = Utils.debounce(this._showFeedback.bind(this), 100);
    }

    // UI 요소 초기화
    init() {
        // 주요 UI 요소 캐싱
        this.elements = {
            // 사이드바 요소들
            sidebar: document.getElementById('sidebar'),
            trackingStatus: document.getElementById('trackingStatus'),
            startBtn: document.getElementById('startBtn'),
            pauseBtn: document.getElementById('pauseBtn'),
            stopBtn: document.getElementById('stopBtn'),
            simBtn: document.getElementById('simBtn'),
            saveStatus: document.getElementById('saveStatus'),
            permissionBanner: document.getElementById('permissionBanner'),
            
            // 통계 요소들
            totalDistance: document.getElementById('totalDistance'),
            currentSpeed: document.getElementById('currentSpeed'),
            trackingTime: document.getElementById('trackingTime'),
            routeCount: document.getElementById('routeCount'),
            
            // 팝업 요소들
            statsPopup: document.getElementById('statsPopup'),
            popupDistance: document.getElementById('popupDistance'),
            popupTime: document.getElementById('popupTime'),
            popupRoutes: document.getElementById('popupRoutes'),
            popupStatus: document.getElementById('popupStatus'),
            
            // 플로팅 요소들
            floatingTrackBtn: document.getElementById('floatingTrackBtn'),
            floatingSimBtn: document.getElementById('floatingSimBtn'),
            gpsFeedback: document.getElementById('gpsFeedback'),
            
            // 로딩
            loading: document.getElementById('loading')
        };
        
        // 이벤트 리스너 설정
        this._setupEventListeners();
    }

    // 이벤트 리스너 설정
    _setupEventListeners() {
        // 창 크기 변경
        window.addEventListener('resize', Utils.debounce(() => {
            this._handleResize();
        }, 250));

        // 사이드바 외부 클릭 시 닫기 (모바일)
        if (Utils.isMobile()) {
            document.addEventListener('click', (e) => {
                if (this.elements.sidebar.classList.contains('show') && 
                    !this.elements.sidebar.contains(e.target) &&
                    !e.target.classList.contains('toggle-sidebar')) {
                    this.toggleSidebar();
                }
            });
        }

        // 키보드 단축키
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + S: 저장
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (window.app) {
                    window.app.saveDataManually();
                }
            }
        });
    }

    // 로딩 화면 숨기기
    hideLoading() {
        if (this.elements.loading) {
            this.elements.loading.style.display = 'none';
        }
    }

    // GPS 추적 상태 업데이트
    updateTrackingStatus(isTracking, isPaused) {
        if (isTracking) {
            if (isPaused) {
                this.elements.trackingStatus.innerHTML = 
                    '<div class="status-indicator status-paused"></div><span>일시정지됨</span>';
                this.elements.startBtn.textContent = '📍 추적 중 (일시정지)';
                this.elements.startBtn.className = 'full-width stopped';
                this.elements.pauseBtn.textContent = '▶️ 재개';
                this.elements.pauseBtn.className = '';
                this.elements.floatingTrackBtn.className = 'control-button active';
            } else {
                this.elements.trackingStatus.innerHTML = 
                    '<div class="status-indicator status-tracking"></div><span>추적 중</span>';
                this.elements.startBtn.textContent = '📍 추적 중';
                this.elements.startBtn.className = 'full-width tracking';
                this.elements.pauseBtn.textContent = '⏸️ 일시정지';
                this.elements.pauseBtn.className = '';
                this.elements.floatingTrackBtn.className = 'control-button tracking';
            }
            this.elements.stopBtn.className = '';
        } else {
            this.elements.trackingStatus.innerHTML = 
                '<div class="status-indicator status-stopped"></div><span>추적 중지됨</span>';
            this.elements.startBtn.textContent = '📍 추적 시작';
            this.elements.startBtn.className = 'full-width';
            this.elements.pauseBtn.className = 'stopped';
            this.elements.stopBtn.className = 'stopped';
            this.elements.floatingTrackBtn.className = 'control-button';
        }
    }

    // 시뮬레이션 상태 업데이트
    updateSimulationStatus(isRunning) {
        if (isRunning) {
            this.elements.simBtn.textContent = '시뮬레이션 정지';
            this.elements.simBtn.classList.add('active');
            this.elements.floatingSimBtn.classList.add('active');
        } else {
            this.elements.simBtn.textContent = '시뮬레이션 시작';
            this.elements.simBtn.classList.remove('active');
            this.elements.floatingSimBtn.classList.remove('active');
        }
    }

    // 전체 UI 업데이트
    _updateUI() {
        this.updateStats();
    }

    // 통계 업데이트
    _updateStats(stats = {}) {
        // 거리
        if (stats.totalDistance !== undefined && this.elements.totalDistance) {
            this.elements.totalDistance.textContent = stats.totalDistance;
            if (this.elements.popupDistance) {
                this.elements.popupDistance.textContent = stats.totalDistance;
            }
        }

        // 속도
        if (stats.currentSpeed !== undefined && this.elements.currentSpeed) {
            this.elements.currentSpeed.textContent = stats.currentSpeed;
        }

        // 시간
        if (stats.trackingTime !== undefined && this.elements.trackingTime) {
            this.elements.trackingTime.textContent = stats.trackingTime;
            if (this.elements.popupTime) {
                this.elements.popupTime.textContent = stats.trackingTime;
            }
        }

        // 경로 수
        if (stats.routeCount !== undefined && this.elements.routeCount) {
            this.elements.routeCount.textContent = stats.routeCount;
            if (this.elements.popupRoutes) {
                this.elements.popupRoutes.textContent = stats.routeCount;
            }
        }

        // 상태
        if (stats.status !== undefined && this.elements.popupStatus) {
            this.elements.popupStatus.textContent = stats.status;
        }
    }

    // 피드백 메시지 표시
    _showFeedback(message, duration = 3000) {
        const feedback = this.elements.gpsFeedback;
        if (!feedback) return;

        feedback.textContent = message;
        feedback.classList.add('show');

        if (this.feedbackTimeout) {
            clearTimeout(this.feedbackTimeout);
        }

        this.feedbackTimeout = setTimeout(() => {
            feedback.classList.remove('show');
        }, duration);
    }

    // 사이드바 토글
    toggleSidebar() {
        const sidebar = this.elements.sidebar;
        const isMobile = window.innerWidth <= 768;

        if (isMobile) {
            sidebar.classList.toggle('show');
        } else {
            sidebar.classList.toggle('collapsed');
        }
    }

    // 통계 팝업 토글
    toggleStatsPopup() {
        const popup = this.elements.statsPopup;
        const isVisible = popup.classList.contains('show');

        if (isVisible) {
            popup.classList.remove('show');
            if (this.statsTimeout) {
                clearTimeout(this.statsTimeout);
            }
        } else {
            popup.classList.add('show');
            
            // 5초 후 자동으로 닫기
            this.statsTimeout = setTimeout(() => {
                popup.classList.remove('show');
            }, 5000);
        }
    }

    // 권한 배너 표시
    showPermissionBanner() {
        if (this.elements.permissionBanner) {
            this.elements.permissionBanner.style.display = 'block';
        }
    }

    // 권한 배너 숨기기
    hidePermissionBanner() {
        if (this.elements.permissionBanner) {
            this.elements.permissionBanner.style.display = 'none';
        }
    }

    // 저장 상태 업데이트
    updateSaveStatus(time) {
        if (this.elements.saveStatus) {
            const timeStr = time.toLocaleTimeString();
            this.elements.saveStatus.innerHTML = 
                `💾 마지막 저장: ${timeStr}<br><small>자동 저장 활성화</small>`;
        }
    }

    // 속도 버튼 활성화
    setActiveSpeedButton(speed) {
        document.querySelectorAll('.speed').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const activeBtn = document.querySelector(`.speed[onclick*="${speed}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }
    }

    // 위치 찾기 애니메이션
    showLocatingAnimation() {
        this.elements.floatingTrackBtn.classList.add('locating');
    }

    // 위치 찾기 애니메이션 중지
    hideLocatingAnimation() {
        this.elements.floatingTrackBtn.classList.remove('locating');
    }

    // 에러 애니메이션
    showErrorAnimation(element) {
        element.classList.add('error-shake');
        setTimeout(() => {
            element.classList.remove('error-shake');
        }, 500);
    }

    // 성공 애니메이션
    showSuccessAnimation(element) {
        element.classList.add('save-success');
        setTimeout(() => {
            element.classList.remove('save-success');
        }, 500);
    }

    // 반응형 처리
    _handleResize() {
        const isMobile = window.innerWidth <= 768;
        const sidebar = this.elements.sidebar;

        if (!isMobile) {
            // 데스크톱으로 전환 시 모바일 클래스 제거
            sidebar.classList.remove('show');
        } else {
            // 모바일로 전환 시 collapsed 클래스 제거
            sidebar.classList.remove('collapsed');
        }

        // 지도 크기 재조정 알림
        if (window.app && window.app.map) {
            window.app.map.invalidateSize();
        }
    }

    // 다이얼로그 표시
    showDialog(options) {
        const {
            title = '알림',
            message = '',
            type = 'info', // info, warning, error, success
            buttons = [{ text: '확인', action: null }]
        } = options;

        // 간단한 alert 사용 (추후 커스텀 다이얼로그로 교체 가능)
        alert(`${title}\n\n${message}`);
    }

    // 확인 다이얼로그
    async confirmDialog(message) {
        return confirm(message);
    }

    // 프로그레스 표시
    showProgress(message, percentage = 0) {
        // 추후 구현: 프로그레스 바 UI
        this.showFeedback(`${message} (${percentage}%)`);
    }

    // 툴팁 표시
    showTooltip(element, message, position = 'top') {
        // 추후 구현: 커스텀 툴팁
    }

    // 컨텍스트 메뉴 표시
    showContextMenu(x, y, items) {
        // 추후 구현: 커스텀 컨텍스트 메뉴
    }

    // 알림 표시 (토스트)
    showNotification(message, type = 'info', duration = 3000) {
        // 추후 구현: 토스트 알림
        this.showFeedback(message, duration);
    }

    // 배지 업데이트
    updateBadge(element, count) {
        // 추후 구현: 숫자 배지
    }

    // 다크/라이트 테마 전환
    toggleTheme() {
        // 추후 구현: 테마 전환
    }

    // UI 상태 저장
    saveUIState() {
        const state = {
            sidebarCollapsed: this.elements.sidebar.classList.contains('collapsed'),
            statsPopupVisible: this.elements.statsPopup.classList.contains('show'),
            // 기타 UI 상태
        };
        
        localStorage.setItem('daedongMap_uiState', JSON.stringify(state));
    }

    // UI 상태 복원
    restoreUIState() {
        try {
            const state = JSON.parse(localStorage.getItem('daedongMap_uiState') || '{}');
            
            if (state.sidebarCollapsed) {
                this.elements.sidebar.classList.add('collapsed');
            }
            
            // 기타 UI 상태 복원
        } catch (error) {
            console.error('UI 상태 복원 실패:', error);
        }
    }

    // 접근성 개선
    announceToScreenReader(message) {
        const announcement = document.createElement('div');
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-live', 'polite');
        announcement.classList.add('sr-only');
        announcement.textContent = message;
        
        document.body.appendChild(announcement);
        
        setTimeout(() => {
            document.body.removeChild(announcement);
        }, 1000);
    }

    // 키보드 네비게이션 지원
    enableKeyboardNavigation() {
        // Tab 키로 주요 요소 탐색
        const focusableElements = [
            this.elements.startBtn,
            this.elements.pauseBtn,
            this.elements.stopBtn,
            // 기타 포커스 가능한 요소들
        ];

        focusableElements.forEach((element, index) => {
            if (element) {
                element.tabIndex = index + 1;
            }
        });
    }

    // 페이지 이탈 방지
    setBeforeUnloadHandler(handler) {
        window.addEventListener('beforeunload', handler);
    }

    // 온라인/오프라인 상태 표시
    updateOnlineStatus(isOnline) {
        if (isOnline) {
            this.showFeedback('인터넷 연결이 복구되었습니다');
        } else {
            this.showFeedback('오프라인 모드 - GPS 추적은 계속됩니다');
        }
    }
}

// 전역 객체로 내보내기
window.UIManager = UIManager;