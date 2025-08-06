// js/gps.js - GPS 추적 기능

class GPSTracker {
    constructor() {
        this.watchId = null;
        this.isTracking = false;
        this.isPaused = false;
        this.lastValidLocation = null;
        this.locationUpdateCount = 0;
        this.trackingStartTime = null;
        
        // GPS 옵션
        this.options = {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 30000
        };
        
        // 콜백 함수들
        this.callbacks = {
            onUpdate: null,
            onError: null,
            onStart: null,
            onStop: null,
            onPause: null
        };
        
        // Throttle된 위치 업데이트 함수
        this.onLocationUpdate = Utils.throttle(this._onLocationUpdate.bind(this), 2000);
    }

    // 콜백 설정
    setCallbacks(callbacks) {
        Object.assign(this.callbacks, callbacks);
    }

    // GPS 추적 시작
    startTracking() {
        if (this.isTracking) {
            console.log('이미 추적 중입니다');
            return false;
        }

        if (!navigator.geolocation) {
            this._handleError({
                code: 0,
                message: '이 브라우저는 GPS를 지원하지 않습니다'
            });
            return false;
        }

        console.log('GPS 추적 시작');
        
        try {
            this.watchId = navigator.geolocation.watchPosition(
                position => this.onLocationUpdate(position),
                error => this._onLocationError(error),
                this.options
            );

            this.isTracking = true;
            this.isPaused = false;
            this.trackingStartTime = new Date();
            this.locationUpdateCount = 0;
            
            if (this.callbacks.onStart) {
                this.callbacks.onStart();
            }
            
            return true;
        } catch (error) {
            console.error('GPS 시작 실패:', error);
            this._handleError({
                code: 0,
                message: 'GPS 시작에 실패했습니다'
            });
            return false;
        }
    }

    // GPS 추적 일시정지/재개
    pauseTracking() {
        if (!this.isTracking) return false;
        
        this.isPaused = !this.isPaused;
        
        if (this.callbacks.onPause) {
            this.callbacks.onPause(this.isPaused);
        }
        
        console.log('GPS 추적', this.isPaused ? '일시정지' : '재개');
        return true;
    }

    // GPS 추적 정지
    stopTracking() {
        if (!this.isTracking) return false;

        try {
            if (this.watchId) {
                navigator.geolocation.clearWatch(this.watchId);
                this.watchId = null;
            }

            this.isTracking = false;
            this.isPaused = false;
            this.locationUpdateCount = 0;
            this.lastValidLocation = null;
            
            if (this.callbacks.onStop) {
                this.callbacks.onStop();
            }
            
            console.log('GPS 추적 정지');
            return true;
            
        } catch (error) {
            console.error('GPS 정지 실패:', error);
            return false;
        }
    }

    // 현재 위치 가져오기 (일회성)
    getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('GPS를 지원하지 않는 브라우저입니다'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                position => {
                    resolve({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: new Date()
                    });
                },
                error => {
                    reject(error);
                },
                this.options
            );
        });
    }

    // 위치 업데이트 처리
    _onLocationUpdate(position) {
        try {
            const { latitude: lat, longitude: lng, accuracy, speed } = position.coords;
            const timestamp = new Date();
            
            this.locationUpdateCount++;

            // 정확도 필터링 (초기에는 느슨하게, 나중에는 엄격하게)
            const accuracyThreshold = this.locationUpdateCount < 5 ? 200 : 100;
            if (accuracy > accuracyThreshold) {
                console.warn(`GPS 정확도 낮음: ${Math.round(accuracy)}m`);
                if (this.callbacks.onError) {
                    this.callbacks.onError({
                        code: 'LOW_ACCURACY',
                        message: `GPS 정확도 낮음 (${Math.round(accuracy)}m)`,
                        accuracy: accuracy
                    });
                }
                return;
            }

            // 비정상적인 위치 변화 필터링
            if (this.lastValidLocation) {
                const distance = Utils.calculateDistance(
                    this.lastValidLocation.lat,
                    this.lastValidLocation.lng,
                    lat,
                    lng
                );
                const timeDiff = (timestamp - this.lastValidLocation.timestamp) / 1000;
                const calculatedSpeed = distance / timeDiff;
                
                // 시속 200km 이상 필터링
                if (calculatedSpeed > 55.6) {
                    console.warn('비정상적인 위치 변화 감지', {
                        speed: calculatedSpeed * 3.6,
                        distance: distance
                    });
                    return;
                }
            }

            // 유효한 위치 업데이트
            const locationData = {
                lat,
                lng,
                accuracy,
                speed: speed || 0,
                timestamp,
                isTracking: this.isTracking && !this.isPaused
            };

            this.lastValidLocation = locationData;

            // 콜백 실행
            if (this.callbacks.onUpdate) {
                this.callbacks.onUpdate(locationData);
            }

        } catch (error) {
            console.error('위치 업데이트 처리 실패:', error);
        }
    }

    // 위치 오류 처리
    _onLocationError(error) {
        const errorMessages = {
            [error.PERMISSION_DENIED]: '위치 권한이 거부되었습니다',
            [error.POSITION_UNAVAILABLE]: '위치 정보를 사용할 수 없습니다',
            [error.TIMEOUT]: '위치 요청 시간이 초과되었습니다'
        };
        
        const errorData = {
            code: error.code,
            message: errorMessages[error.code] || '알 수 없는 GPS 오류가 발생했습니다',
            originalError: error
        };
        
        this._handleError(errorData);
    }

    // 에러 처리
    _handleError(error) {
        console.error('GPS 오류:', error);
        
        if (this.callbacks.onError) {
            this.callbacks.onError(error);
        }
        
        // 권한 거부 시 추적 중지
        if (error.code === 1) { // PERMISSION_DENIED
            this.stopTracking();
        }
    }

    // GPS 상태 확인
    getStatus() {
        return {
            isTracking: this.isTracking,
            isPaused: this.isPaused,
            updateCount: this.locationUpdateCount,
            lastLocation: this.lastValidLocation,
            trackingDuration: this.trackingStartTime ? 
                Math.floor((Date.now() - this.trackingStartTime) / 1000) : 0
        };
    }

    // GPS 권한 요청
    async requestPermission() {
        try {
            // 권한 API 사용 가능한 경우
            if ('permissions' in navigator) {
                const result = await navigator.permissions.query({ name: 'geolocation' });
                
                if (result.state === 'granted') {
                    return true;
                } else if (result.state === 'prompt') {
                    // 실제 위치 요청으로 권한 프롬프트 트리거
                    await this.getCurrentPosition();
                    return true;
                } else {
                    return false;
                }
            } else {
                // 권한 API가 없는 경우 직접 위치 요청
                await this.getCurrentPosition();
                return true;
            }
        } catch (error) {
            console.error('권한 요청 실패:', error);
            return false;
        }
    }

    // GPS 정확도 향상을 위한 보정
    calibrateLocation(location) {
        // 칼만 필터나 다른 보정 알고리즘 적용 가능
        // 현재는 기본값 반환
        return location;
    }

    // 배터리 절약 모드 설정
    setBatterySaveMode(enabled) {
        if (enabled) {
            this.options.enableHighAccuracy = false;
            this.options.maximumAge = 60000; // 1분
        } else {
            this.options.enableHighAccuracy = true;
            this.options.maximumAge = 30000; // 30초
        }
        
        // 추적 중이면 재시작
        if (this.isTracking) {
            this.stopTracking();
            setTimeout(() => this.startTracking(), 100);
        }
    }
}

// 전역 객체로 내보내기
window.GPSTracker = GPSTracker;