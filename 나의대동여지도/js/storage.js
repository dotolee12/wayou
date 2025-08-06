// js/storage.js - 데이터 저장/불러오기

class StorageManager {
    constructor() {
        this.storageKey = 'daedongMap_data';
        this.maxStorageSize = 5 * 1024 * 1024; // 5MB 제한
        this.compression = true;
        
        // Debounce된 저장 함수
        this.saveToStorage = Utils.debounce(this._saveToStorage.bind(this), 1000);
    }

    // 데이터 저장
    _saveToStorage(data) {
        try {
            const serializedData = this._serializeData(data);
            const dataStr = JSON.stringify(serializedData);
            
            // 용량 체크
            if (dataStr.length > this.maxStorageSize) {
                console.warn('데이터 크기가 제한을 초과합니다');
                // 오래된 경로 일부 삭제
                this._cleanupOldData(data);
                return this._saveToStorage(data);
            }
            
            localStorage.setItem(this.storageKey, dataStr);
            
            // 저장 시간 업데이트
            this._updateSaveStatus();
            
            return true;
        } catch (error) {
            console.error('데이터 저장 실패:', error);
            
            // 용량 부족 시 처리
            if (error.name === 'QuotaExceededError') {
                this._handleStorageQuotaExceeded();
            }
            
            return false;
        }
    }

    // 데이터 직렬화
    _serializeData(data) {
        return {
            routes: data.routes.map(route => ({
                id: route.id,
                points: this._compressPoints(route.points),
                startTime: route.startTime.getTime(),
                endTime: route.endTime?.getTime(),
                distance: Math.round(route.distance)
            })),
            stayAreas: data.stayAreas.map(area => ({
                lat: Math.round(area.lat * 1000000) / 1000000,
                lng: Math.round(area.lng * 1000000) / 1000000,
                startTime: area.startTime.getTime(),
                endTime: area.endTime.getTime(),
                duration: area.duration
            })),
            totalDistance: Math.round(data.totalDistance),
            lastSaved: Date.now(),
            version: '2.1'
        };
    }

    // 포인트 압축
    _compressPoints(points) {
        if (!this.compression || points.length < 10) {
            return points.map(p => ({
                lat: Math.round(p.lat * 1000000) / 1000000,
                lng: Math.round(p.lng * 1000000) / 1000000,
                timestamp: p.timestamp.getTime(),
                accuracy: Math.round(p.accuracy)
            }));
        }

        // Douglas-Peucker 알고리즘으로 포인트 단순화
        const simplified = this._simplifyPath(points, 0.00001);
        
        return simplified.map(p => ({
            lat: Math.round(p.lat * 1000000) / 1000000,
            lng: Math.round(p.lng * 1000000) / 1000000,
            timestamp: p.timestamp.getTime(),
            accuracy: Math.round(p.accuracy)
        }));
    }

    // Douglas-Peucker 경로 단순화 알고리즘
    _simplifyPath(points, tolerance) {
        if (points.length <= 2) return points;
        
        let maxDistance = 0;
        let maxIndex = 0;
        
        // 시작점과 끝점 사이의 직선으로부터 가장 먼 점 찾기
        for (let i = 1; i < points.length - 1; i++) {
            const distance = this._pointToLineDistance(
                points[i],
                points[0],
                points[points.length - 1]
            );
            
            if (distance > maxDistance) {
                maxDistance = distance;
                maxIndex = i;
            }
        }
        
        // 허용 오차보다 크면 재귀적으로 단순화
        if (maxDistance > tolerance) {
            const left = this._simplifyPath(points.slice(0, maxIndex + 1), tolerance);
            const right = this._simplifyPath(points.slice(maxIndex), tolerance);
            
            return left.slice(0, -1).concat(right);
        }
        
        return [points[0], points[points.length - 1]];
    }

    // 점과 직선 사이의 거리 계산
    _pointToLineDistance(point, lineStart, lineEnd) {
        const A = point.lat - lineStart.lat;
        const B = point.lng - lineStart.lng;
        const C = lineEnd.lat - lineStart.lat;
        const D = lineEnd.lng - lineStart.lng;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        const param = lenSq !== 0 ? dot / lenSq : -1;
        
        let xx, yy;
        
        if (param < 0) {
            xx = lineStart.lat;
            yy = lineStart.lng;
        } else if (param > 1) {
            xx = lineEnd.lat;
            yy = lineEnd.lng;
        } else {
            xx = lineStart.lat + param * C;
            yy = lineStart.lng + param * D;
        }
        
        const dx = point.lat - xx;
        const dy = point.lng - yy;
        
        return Math.sqrt(dx * dx + dy * dy);
    }

    // 데이터 불러오기
    loadFromStorage() {
        try {
            const savedData = localStorage.getItem(this.storageKey);
            if (!savedData) return null;

            const data = JSON.parse(savedData);
            
            // 버전 체크
            if (data.version !== '2.1') {
                console.warn('데이터 버전이 다릅니다. 마이그레이션이 필요할 수 있습니다.');
            }
            
            // 데이터 역직렬화
            return {
                routes: data.routes?.map(route => ({
                    ...route,
                    points: route.points.map(p => ({
                        lat: p.lat,
                        lng: p.lng,
                        timestamp: new Date(p.timestamp),
                        accuracy: p.accuracy
                    })),
                    startTime: new Date(route.startTime),
                    endTime: route.endTime ? new Date(route.endTime) : null
                })) || [],
                stayAreas: data.stayAreas?.map(area => ({
                    ...area,
                    startTime: new Date(area.startTime),
                    endTime: new Date(area.endTime),
                    marker: null
                })) || [],
                totalDistance: data.totalDistance || 0,
                lastSaved: new Date(data.lastSaved)
            };
        } catch (error) {
            console.error('데이터 복원 실패:', error);
            
            // 손상된 데이터 백업
            this._backupCorruptedData();
            
            return null;
        }
    }

    // 데이터 내보내기
    exportData(data) {
        try {
            const exportData = {
                ...this._serializeData(data),
                exportTime: new Date().toISOString(),
                userAgent: navigator.userAgent
            };

            const dataStr = JSON.stringify(exportData, null, 2);
            const dataBlob = new Blob([dataStr], {type: 'application/json'});
            const url = URL.createObjectURL(dataBlob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = `나의대동여지도_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            
            return true;
        } catch (error) {
            console.error('데이터 내보내기 실패:', error);
            return false;
        }
    }

    // 데이터 가져오기
    async importData(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            // 데이터 유효성 검증
            if (!this._validateImportData(data)) {
                throw new Error('유효하지 않은 데이터 형식입니다');
            }
            
            // 현재 데이터 백업
            this._backupCurrentData();
            
            // 데이터 저장
            localStorage.setItem(this.storageKey, text);
            
            return true;
        } catch (error) {
            console.error('데이터 가져오기 실패:', error);
            return false;
        }
    }

    // 저장된 데이터 삭제
    clearStoredData() {
        try {
            // 백업
            this._backupCurrentData();
            
            // 삭제
            localStorage.removeItem(this.storageKey);
            
            return true;
        } catch (error) {
            console.error('데이터 삭제 실패:', error);
            return false;
        }
    }

    // 저장 상태 업데이트
    _updateSaveStatus() {
        const saveStatus = document.getElementById('saveStatus');
        if (saveStatus) {
            const now = new Date();
            const time = now.toLocaleTimeString();
            saveStatus.innerHTML = `💾 마지막 저장: ${time}<br><small>자동 저장 활성화</small>`;
        }
    }

    // 오래된 데이터 정리
    _cleanupOldData(data) {
        // 30일 이상 된 경로 삭제
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        data.routes = data.routes.filter(route => {
            return route.startTime.getTime() > thirtyDaysAgo;
        });
        
        console.log('오래된 데이터가 정리되었습니다');
    }

    // 용량 초과 처리
    _handleStorageQuotaExceeded() {
        const ui = window.app?.ui;
        if (ui) {
            ui.showFeedback('저장 공간이 부족합니다. 오래된 데이터를 삭제해주세요.');
        }
    }

    // 손상된 데이터 백업
    _backupCorruptedData() {
        try {
            const corrupted = localStorage.getItem(this.storageKey);
            if (corrupted) {
                localStorage.setItem(this.storageKey + '_backup', corrupted);
                localStorage.removeItem(this.storageKey);
            }
        } catch (e) {
            console.error('백업 실패:', e);
        }
    }

    // 현재 데이터 백업
    _backupCurrentData() {
        try {
            const current = localStorage.getItem(this.storageKey);
            if (current) {
                localStorage.setItem(this.storageKey + '_backup', current);
            }
        } catch (e) {
            console.error('백업 실패:', e);
        }
    }

    // 가져온 데이터 유효성 검증
    _validateImportData(data) {
        return data && 
               data.version && 
               Array.isArray(data.routes) && 
               Array.isArray(data.stayAreas) &&
               typeof data.totalDistance === 'number';
    }

    // 저장소 상태 확인
    getStorageStatus() {
        const used = Utils.getStorageSize();
        const percentage = (used / this.maxStorageSize) * 100;
        
        return {
            used: used,
            total: this.maxStorageSize,
            percentage: percentage.toFixed(1),
            available: this.maxStorageSize - used
        };
    }
}

// 전역 객체로 내보내기
window.StorageManager = StorageManager;