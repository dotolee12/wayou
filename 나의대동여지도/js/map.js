// js/map.js - 지도 관련 기능

class MapManager {
    constructor(mapElementId) {
        this.mapElementId = mapElementId;
        this.map = null;
        this.currentLocationMarker = null;
        this.routePolylines = new Map();
        this.stayMarkers = new Map();
        this.currentMapStyle = 0;
        
        // 지도 스타일 옵션
        this.mapStyles = [
            {
                name: 'Dark Theme',
                url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
                attribution: '© OpenStreetMap contributors © CartoDB'
            },
            {
                name: 'Standard',
                url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                attribution: '© OpenStreetMap contributors'
            },
            {
                name: 'Satellite',
                url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                attribution: 'Tiles © Esri'
            }
        ];

        // 기억 단계별 스타일
        this.memoryStages = [
            { threshold: 36000, color: '#FFFFFF', opacity: 1.0 },   // 10시간: 흰색
            { threshold: 50400, color: '#32CD32', opacity: 0.4 },   // 14시간: 초록색
            { threshold: 604800, color: '#FFA500', opacity: 0.4 },  // 7일: 주황색
            { threshold: 2592000, color: '#FF0000', opacity: 0.4 }, // 30일: 빨간색
            { threshold: Infinity, color: '#8B4513', opacity: 0.4 }  // 영구: 갈색
        ];
        
        // Throttle된 업데이트 함수
        this.updateCurrentLocationMarker = Utils.throttle(
            this._updateCurrentLocationMarker.bind(this), 
            1000
        );
    }

    // 지도 초기화
    init() {
        try {
            this.map = L.map(this.mapElementId, {
                zoomControl: false,
                preferCanvas: true,
                renderer: L.canvas({
                    padding: 0.5,
                    tolerance: 10
                })
            }).setView([37.5665, 126.9780], 13); // 서울 기본 좌표

            // 타일 레이어 추가
            this._addTileLayer();

            // 줌 컨트롤 추가
            L.control.zoom({
                position: 'bottomright'
            }).addTo(this.map);

            console.log('지도 초기화 완료');
            return true;
            
        } catch (error) {
            console.error('지도 초기화 실패:', error);
            return false;
        }
    }

    // 타일 레이어 추가
    _addTileLayer() {
        const style = this.mapStyles[this.currentMapStyle];
        
        L.tileLayer(style.url, {
            attribution: style.attribution,
            maxZoom: 19,
            detectRetina: true,
            updateWhenIdle: true
        }).addTo(this.map);
    }

    // 지도 스타일 변경
    changeMapStyle() {
        try {
            // 현재 타일 레이어 제거
            this.map.eachLayer(layer => {
                if (layer instanceof L.TileLayer) {
                    this.map.removeLayer(layer);
                }
            });

            // 다음 스타일로 변경
            this.currentMapStyle = (this.currentMapStyle + 1) % this.mapStyles.length;
            this._addTileLayer();

            const styleName = this.mapStyles[this.currentMapStyle].name;
            console.log(`지도 스타일 변경: ${styleName}`);
            
            return styleName;
            
        } catch (error) {
            console.error('지도 스타일 변경 실패:', error);
            return null;
        }
    }

    // 현재 위치 마커 업데이트
    _updateCurrentLocationMarker(lat, lng) {
        try {
            // 기존 마커 제거
            if (this.currentLocationMarker) {
                this.map.removeLayer(this.currentLocationMarker);
            }

            // 새 마커 추가
            this.currentLocationMarker = L.circleMarker([lat, lng], {
                radius: 8,
                fillColor: '#4ecdc4',
                color: 'white',
                weight: 3,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(this.map);

            // 정확도 원 추가 (옵션)
            // if (accuracy) {
            //     L.circle([lat, lng], {
            //         radius: accuracy,
            //         fillColor: '#4ecdc4',
            //         color: '#4ecdc4',
            //         weight: 1,
            //         opacity: 0.2,
            //         fillOpacity: 0.1
            //     }).addTo(this.map);
            // }
            
        } catch (error) {
            console.error('위치 마커 업데이트 실패:', error);
        }
    }

    // 지도 중심 이동
    setView(lat, lng, zoom = null) {
        if (this.map) {
            if (zoom) {
                this.map.setView([lat, lng], zoom);
            } else {
                this.map.setView([lat, lng]);
            }
        }
    }

    // 현재 위치로 이동
    centerOnLocation(lat, lng) {
        this.setView(lat, lng, 16);
        this.updateCurrentLocationMarker(lat, lng);
    }

    // 경로 스타일 계산
    getRouteStyle(startTime, currentTime = new Date()) {
        const elapsed = (currentTime - startTime) / 1000; // 초 단위
        
        for (let stage of this.memoryStages) {
            if (elapsed < stage.threshold) {
                let opacity = stage.opacity;
                
                // 첫 단계(흰색)는 시간에 따라 투명도 감소
                if (stage.threshold === 36000 && elapsed < 36000) {
                    const progress = elapsed / 36000;
                    opacity = 1.0 - (0.6 * progress); // 100% → 40%
                }
                
                return { color: stage.color, opacity };
            }
        }
        
        return { color: '#8B4513', opacity: 0.4 };
    }

    // 경로 그리기
    drawRoute(route, currentTime = new Date()) {
        try {
            // 기존 경로 제거
            if (this.routePolylines.has(route.id)) {
                this.map.removeLayer(this.routePolylines.get(route.id));
            }

            if (!route.points || route.points.length < 2) return;

            // 좌표 배열 생성
            const latlngs = route.points.map(p => [p.lat, p.lng]);
            
            // 스타일 계산
            const style = this.getRouteStyle(route.startTime, currentTime);

            // 폴리라인 생성
            const polyline = L.polyline(latlngs, {
                color: style.color,
                weight: 4,
                opacity: style.opacity,
                renderer: L.canvas(),
                smoothFactor: 1
            }).addTo(this.map);

            // 저장
            this.routePolylines.set(route.id, polyline);
            
        } catch (error) {
            console.error('경로 그리기 실패:', error);
        }
    }

    // 모든 경로 업데이트
    updateAllRoutes(routes, currentTime = new Date()) {
        routes.forEach(route => {
            this.drawRoute(route, currentTime);
        });
    }

    // 체류 구역 그리기
    drawStayArea(area) {
        try {
            // 기존 마커 제거
            const key = `${area.lat}_${area.lng}`;
            if (this.stayMarkers.has(key)) {
                this.map.removeLayer(this.stayMarkers.get(key));
            }

            // 1시간 이상 체류한 구역만 표시
            if (area.duration >= 3600000) {
                const marker = L.circleMarker([area.lat, area.lng], {
                    radius: 15,
                    fillColor: '#FFD700',
                    color: '#FFA500',
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0.6
                }).addTo(this.map);

                // 툴팁 추가
                const hours = Math.floor(area.duration / 3600000);
                const minutes = Math.floor((area.duration % 3600000) / 60000);
                marker.bindTooltip(`체류 시간: ${hours}시간 ${minutes}분`, {
                    permanent: false,
                    direction: 'top'
                });

                this.stayMarkers.set(key, marker);
            }
            
        } catch (error) {
            console.error('체류 구역 그리기 실패:', error);
        }
    }

    // 경로 제거
    removeRoute(routeId) {
        if (this.routePolylines.has(routeId)) {
            this.map.removeLayer(this.routePolylines.get(routeId));
            this.routePolylines.delete(routeId);
        }
    }

    // 모든 경로 제거
    clearAllRoutes() {
        this.routePolylines.forEach(polyline => {
            this.map.removeLayer(polyline);
        });
        this.routePolylines.clear();
    }

    // 모든 체류 구역 제거
    clearAllStayAreas() {
        this.stayMarkers.forEach(marker => {
            this.map.removeLayer(marker);
        });
        this.stayMarkers.clear();
    }

    // 경로 경계에 맞춰 지도 조정
    fitBounds(routes) {
        if (!routes || routes.length === 0) return;

        const allPoints = [];
        routes.forEach(route => {
            if (route.points) {
                route.points.forEach(p => {
                    allPoints.push([p.lat, p.lng]);
                });
            }
        });

        if (allPoints.length > 0) {
            const bounds = L.latLngBounds(allPoints);
            this.map.fitBounds(bounds, { padding: [50, 50] });
        }
    }

    // 지도 새로고침
    invalidateSize() {
        if (this.map) {
            this.map.invalidateSize();
        }
    }

    // 히트맵 레이어 추가 (선택사항)
    addHeatmapLayer(points) {
        // Leaflet.heat 플러그인이 필요
        if (typeof L.heatLayer === 'function') {
            const heat = L.heatLayer(points, {
                radius: 25,
                blur: 15,
                maxZoom: 17
            }).addTo(this.map);
            
            return heat;
        }
        return null;
    }

    // 지도 이벤트 리스너 추가
    on(event, callback) {
        if (this.map) {
            this.map.on(event, callback);
        }
    }

    // 지도 상태 가져오기
    getMapState() {
        if (!this.map) return null;
        
        const center = this.map.getCenter();
        return {
            center: { lat: center.lat, lng: center.lng },
            zoom: this.map.getZoom(),
            style: this.mapStyles[this.currentMapStyle].name
        };
    }

    // 지도 스크린샷 (선택사항)
    async takeScreenshot() {
        // leaflet-image 플러그인이 필요
        if (typeof leafletImage === 'function') {
            return new Promise((resolve, reject) => {
                leafletImage(this.map, (err, canvas) => {
                    if (err) {
                        reject(err);
                    } else {
                        canvas.toBlob(blob => resolve(blob));
                    }
                });
            });
        }
        return null;
    }
}

// 전역 객체로 내보내기
window.MapManager = MapManager;