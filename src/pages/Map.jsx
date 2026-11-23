import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../SupabaseClient';

const BASE = import.meta.env.BASE_URL;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_ALERTS_STORAGE_KEY = 'lankastay_road_alerts_v1';
const FALLBACK_PLACE_PHOTO =
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80';

const REPORT_TYPES = {
  crash: {
    label: 'Crash',
    reportingText: 'Reporting crash',
    icon: 'fa-car-burst',
    color: '#dc2626'
  },
  congestion: {
    label: 'Congestion',
    reportingText: 'Reporting congestion',
    icon: 'fa-car-side',
    color: '#dc2626'
  },
  police: {
    label: 'Police',
    reportingText: 'Reporting police',
    icon: 'fa-shield-halved',
    color: '#2563eb'
  },
  roadworks: {
    label: 'Roadworks',
    reportingText: 'Reporting roadworks',
    icon: 'fa-person-digging',
    color: '#eab308'
  },
  lane_closure: {
    label: 'Lane closure',
    reportingText: 'Reporting lane closure',
    icon: 'fa-road-barrier',
    color: '#eab308'
  },
  object_on_road: {
    label: 'Object on road',
    reportingText: 'Reporting object on road',
    icon: 'fa-triangle-exclamation',
    color: '#eab308'
  }
};

const QUICK_CHIPS = [
  { id: 'police', label: 'Police', icon: 'fa-shield-halved' },
  { id: 'roadworks', label: 'Construction', icon: 'fa-person-digging' },
  { id: 'congestion', label: 'Traffic', icon: 'fa-car-side' },
  { id: 'crash', label: 'Accident', icon: 'fa-car-burst' }
];

const MODE_CONFIG = {
  driving: { label: 'Drive', profile: 'driving', icon: 'fa-car' },
  cycling: { label: 'Bike', profile: 'bicycle', icon: 'fa-motorcycle' },
  walking: { label: 'Walk', profile: 'foot', icon: 'fa-person-walking' }
};

function ensureSriLankaLabel(placeName) {
  if (!placeName) return 'Sri Lanka';
  return /sri lanka/i.test(placeName) ? placeName : `${placeName}, Sri Lanka`;
}

function formatDuration(seconds) {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatArrivalTime(seconds) {
  const eta = new Date(Date.now() + Math.max(60, seconds) * 1000);
  return eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function snapToRouteSegment(lat, lng, routeCoords) {
  if (!Array.isArray(routeCoords) || routeCoords.length === 0) {
    return { snappedLat: lat, snappedLng: lng, distanceMeters: 0 };
  }
  if (routeCoords.length === 1) {
    const [rLng, rLat] = routeCoords[0];
    const d = getDistanceMeters(lat, lng, rLat, rLng);
    return {
      snappedLat: d <= 55 ? rLat : lat,
      snappedLng: d <= 55 ? rLng : lng,
      distanceMeters: d
    };
  }

  let bestDist = Infinity;
  let bestLat = lat;
  let bestLng = lng;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const [lng1, lat1] = routeCoords[i];
    const [lng2, lat2] = routeCoords[i + 1];
    const dx = lng2 - lng1;
    const dy = lat2 - lat1;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = Math.max(0, Math.min(1, ((lng - lng1) * dx + (lat - lat1) * dy) / lenSq));
    }
    const projLng = lng1 + t * dx;
    const projLat = lat1 + t * dy;
    const d = getDistanceMeters(lat, lng, projLat, projLng);
    if (d < bestDist) {
      bestDist = d;
      bestLat = projLat;
      bestLng = projLng;
    }
  }

  return {
    snappedLat: bestDist <= 55 ? bestLat : lat,
    snappedLng: bestDist <= 55 ? bestLng : lng,
    distanceMeters: bestDist
  };
}

function calculateBearing(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function createVehicleIcon(bearing = 0, avatarType = 'arrow') {
  if (avatarType === 'bike') {
    return L.divIcon({
      className: 'nav-avatar-marker',
      html: `<div style="width:38px;height:38px;border-radius:50%;background:#1d4ed8;border:3px solid #ffffff;box-shadow:0 4px 12px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:16px;transform:rotate(${bearing}deg);transition:transform 0.25s linear;"><i class="fa-solid fa-motorcycle"></i></div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });
  }
  return L.divIcon({
    className: 'nav-arrow-marker',
    html: `<div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;transform:rotate(${bearing}deg);transition:transform 0.25s linear;">
      <div style="position:absolute;top:2px;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:16px solid #1d4ed8;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35));"></div>
      <div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

function createAlertPinIcon(typeKey) {
  const cfg = REPORT_TYPES[typeKey] || REPORT_TYPES.congestion;
  const textColor = cfg.color === '#eab308' ? '#0f172a' : '#ffffff';
  return L.divIcon({
    className: 'road-alert-pin',
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${cfg.color};border:2.5px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:${textColor};font-size:13px;"><i class="fa-solid ${cfg.icon}"></i></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function isWithinOneDay(isoString) {
  if (!isoString) return false;
  const ts = new Date(isoString).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < ONE_DAY_MS;
}

function readLocalAlertsWithinOneDay() {
  try {
    const raw = localStorage.getItem(LOCAL_ALERTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((item) => isWithinOneDay(item.created_at));
    localStorage.setItem(LOCAL_ALERTS_STORAGE_KEY, JSON.stringify(valid));
    return valid;
  } catch {
    return [];
  }
}

function writeLocalAlerts(list) {
  try {
    localStorage.setItem(LOCAL_ALERTS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore
  }
}

function getTurnMeta(step, destinationName) {
  const type = step?.maneuver?.type || '';
  const modifier = (step?.maneuver?.modifier || '').toLowerCase();
  const road = step?.name ? step.name : ensureSriLankaLabel(destinationName);

  if (type === 'arrive') {
    return {
      stepTitle: `Arrive at ${ensureSriLankaLabel(destinationName)}`,
      towardsText: `Arrive at ${ensureSriLankaLabel(destinationName)}`,
      thenIcon: 'fa-flag-checkered',
      icon: 'fa-flag-checkered'
    };
  }
  if (modifier.includes('sharp left')) {
    return {
      stepTitle: `Turn sharp left${step?.name ? ` onto ${step.name}` : ''}`,
      towardsText: road,
      thenIcon: 'fa-arrow-turn-up fa-flip-horizontal',
      icon: 'fa-arrow-turn-up fa-flip-horizontal'
    };
  }
  if (modifier.includes('slight left')) {
    return {
      stepTitle: `Keep slight left${step?.name ? ` onto ${step.name}` : ''}`,
      towardsText: road,
      thenIcon: 'fa-arrow-up-left',
      icon: 'fa-arrow-up-left'
    };
  }
  if (modifier.includes('left')) {
    return {
      stepTitle: `Turn left${step?.name ? ` onto ${step.name}` : ''}`,
      towardsText: road,
      thenIcon: 'fa-arrow-left',
      icon: 'fa-arrow-left'
    };
  }
  if (modifier.includes('sharp right')) {
    return {
      stepTitle: `Turn sharp right${step?.name ? ` onto ${step.name}` : ''}`,
      towardsText: road,
      thenIcon: 'fa-arrow-turn-up',
      icon: 'fa-arrow-turn-up'
    };
  }
  if (modifier.includes('slight right')) {
    return {
      stepTitle: `Keep slight right${step?.name ? ` onto ${step.name}` : ''}`,
      towardsText: road,
      thenIcon: 'fa-arrow-up-right',
      icon: 'fa-arrow-up-right'
    };
  }
  if (modifier.includes('right')) {
    return {
      stepTitle: `Turn right${step?.name ? ` onto ${step.name}` : ''}`,
      towardsText: road,
      thenIcon: 'fa-arrow-right',
      icon: 'fa-arrow-right'
    };
  }
  if (modifier.includes('uturn')) {
    return {
      stepTitle: `Make a U-turn${step?.name ? ` onto ${step.name}` : ''}`,
      towardsText: road,
      thenIcon: 'fa-arrow-turn-down',
      icon: 'fa-arrow-turn-down'
    };
  }
  return {
    stepTitle: `Head towards ${road}`,
    towardsText: road,
    thenIcon: 'fa-arrow-turn-right',
    icon: 'fa-arrow-up'
  };
}

// Fetch live photos automatically from Wikimedia Commons for any searched location
async function fetchPlacePhotosFromWeb(queryName) {
  const clean = (queryName || '').replace(/,\s*sri lanka$/i, '').trim();
  if (!clean) return [FALLBACK_PLACE_PHOTO];

  try {
    const searchTerm = `${clean} Sri Lanka`;
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(
      searchTerm
    )}&gsrlimit=6&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&origin=*`;

    const res = await fetch(url);
    const data = await res.json();
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];

    const urls = pages
      .map((p) => {
        const info = p?.imageinfo?.[0];
        return info?.thumburl || info?.url || '';
      })
      .filter((u) => /\.(jpe?g|png|webp)(\?|$)/i.test(u) || u.includes('thumb.php'));

    if (urls.length > 0) {
      return urls.slice(0, 3);
    }
  } catch {
    // Fallback below
  }

  return [FALLBACK_PLACE_PHOTO];
}

export default function Map() {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const roadLabelOverlayRef = useRef(null);
  const alertMarkersLayerRef = useRef(null);
  const routeLayersRef = useRef([]);
  const routeTimeBadgesRef = useRef([]);
  const startMarkerRef = useRef(null);
  const endMarkerRef = useRef(null);
  const userNavMarkerRef = useRef(null);
  const watchIdRef = useRef(null);
  const animFrameRef = useRef(null);
  const renderedPosRef = useRef(null);
  const prevGpsRef = useRef(null);
  const lastRerouteTimeRef = useRef(0);
  const announcedStepRef = useRef(-1);

  // Location Gate: 'prompt' | 'requesting' | 'granted' | 'denied' | 'unavailable'
  const [locationStatus, setLocationStatus] = useState('prompt');
  const [locationErrorMsg, setLocationErrorMsg] = useState('');
  const [liveCoords, setLiveCoords] = useState(null);
  const [detectedAddress, setDetectedAddress] = useState('Your location');

  // Screen flow: 'explore' | 'directions' | 'navigating'
  const [screenMode, setScreenMode] = useState('explore');
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [placePhotos, setPlacePhotos] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const [travelMode, setTravelMode] = useState('driving');
  const [mapStyle, setMapStyle] = useState('streets');
  const [showTrafficOnMap, setShowTrafficOnMap] = useState(true);
  const [avatarType, setAvatarType] = useState('arrow');

  // Top search bar starts empty ("")
  const [fromText, setFromText] = useState('Your location');
  const [toText, setToText] = useState('');
  const [activeTab, setActiveTab] = useState(null); // 'from' | 'to' | 'explore' | null
  const [suggestions, setSuggestions] = useState([]);

  const [routes, setRoutes] = useState([]);
  const [bestIndex, setBestIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState('');

  // Live GPS step tracking & wrong-way reroute notice (no automatic video playback)
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [rerouteNotice, setRerouteNotice] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  // Report sheet ('closed' | 'grid' | 'confirming')
  const [roadAlerts, setRoadAlerts] = useState([]);
  const [reportModalStage, setReportModalStage] = useState('closed');
  const [pendingReport, setPendingReport] = useState(null);

  // Footer newsletter
  const [subscriberName, setSubscriberName] = useState('');
  const [subscriberEmail, setSubscriberEmail] = useState('');
  const [subscribing, setSubscribing] = useState(false);

  const speakInstruction = useCallback(
    (text) => {
      if (!voiceEnabled || !text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.02;
        window.speechSynthesis.speak(utterance);
      } catch {
        // Ignore
      }
    },
    [voiceEnabled]
  );

  // Fetch live images whenever destination changes
  useEffect(() => {
    if (!destination?.name) {
      setPlacePhotos([]);
      return;
    }

    let cancelled = false;
    setLoadingPhotos(true);

    fetchPlacePhotosFromWeb(destination.name).then((imgs) => {
      if (cancelled) return;
      setPlacePhotos(imgs);
      setLoadingPhotos(false);
    });

    return () => {
      cancelled = true;
    };
  }, [destination]);

  // Load alerts from Supabase + local storage and remove any older than 24h (1 day)
  const loadRoadAlerts = useCallback(async () => {
    const cutoffIso = new Date(Date.now() - ONE_DAY_MS).toISOString();
    const localFresh = readLocalAlertsWithinOneDay();

    try {
      await supabase.from('road_alerts').delete().lt('created_at', cutoffIso);

      const { data, error } = await supabase
        .from('road_alerts')
        .select('*')
        .gte('created_at', cutoffIso)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        const freshDb = data.filter((row) => isWithinOneDay(row.created_at));
        const mergedMap = new Map();
        [...freshDb, ...localFresh].forEach((item) => {
          mergedMap.set(String(item.id), item);
        });
        const merged = Array.from(mergedMap.values()).filter((item) => isWithinOneDay(item.created_at));
        setRoadAlerts(merged);
        return;
      }
    } catch {
      // Fallback to local alerts
    }

    setRoadAlerts(localFresh);
  }, []);

  useEffect(() => {
    loadRoadAlerts();
    const timer = setInterval(loadRoadAlerts, 60 * 1000);
    return () => clearInterval(timer);
  }, [loadRoadAlerts]);

  const handleSelectReportType = async (typeKey) => {
    const cfg = REPORT_TYPES[typeKey] || REPORT_TYPES.police;
    const map = mapInstanceRef.current;
    const center = map ? map.getCenter() : null;
    const lat = liveCoords?.lat ?? center?.lat;
    const lng = liveCoords?.lng ?? center?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;

    const nowIso = new Date().toISOString();
    const newAlert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      alert_type: typeKey,
      note: cfg.label,
      lat,
      lng,
      created_at: nowIso
    };

    try {
      const { data, error } = await supabase
        .from('road_alerts')
        .insert([
          {
            alert_type: typeKey,
            note: cfg.label,
            lat,
            lng,
            created_at: nowIso
          }
        ])
        .select()
        .single();

      if (!error && data) {
        newAlert.id = data.id;
      }
    } catch {
      // Keep local alert
    }

    const updated = [newAlert, ...readLocalAlertsWithinOneDay()];
    writeLocalAlerts(updated);
    setRoadAlerts((prev) => [newAlert, ...prev.filter((a) => isWithinOneDay(a.created_at))]);
    setPendingReport({
      id: newAlert.id,
      alert_type: typeKey,
      label: cfg.label,
      reportingText: cfg.reportingText
    });
    setReportModalStage('confirming');
  };

  const handleUndoReport = async () => {
    if (!pendingReport) {
      setReportModalStage('closed');
      return;
    }
    const targetId = String(pendingReport.id);
    try {
      await supabase.from('road_alerts').delete().eq('id', pendingReport.id);
    } catch {
      // Ignore
    }
    const remaining = readLocalAlertsWithinOneDay().filter((a) => String(a.id) !== targetId);
    writeLocalAlerts(remaining);
    setRoadAlerts((prev) => prev.filter((a) => String(a.id) !== targetId));
    setPendingReport(null);
    setReportModalStage('closed');
  };

  const handleDoneReport = () => {
    setPendingReport(null);
    setReportModalStage('closed');
  };

  // Smoothly moves ONLY when real GPS position updates
  const smoothlyMoveMarkerTo = useCallback(
    (targetLat, targetLng, bearing, shouldFollow) => {
      const map = mapInstanceRef.current;
      const marker = userNavMarkerRef.current;
      if (!map || !marker) return;

      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }

      const startPos = renderedPosRef.current || { lat: targetLat, lng: targetLng };
      const startTime = performance.now();
      const durationMs = 650;

      marker.setIcon(createVehicleIcon(bearing, avatarType));

      const stepAnim = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const ease = 1 - Math.pow(1 - progress, 3);
        const currLat = startPos.lat + (targetLat - startPos.lat) * ease;
        const currLng = startPos.lng + (targetLng - startPos.lng) * ease;

        renderedPosRef.current = { lat: currLat, lng: currLng };
        marker.setLatLng([currLat, currLng]);

        if (shouldFollow) {
          map.panTo([currLat, currLng], { animate: false });
        }

        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(stepAnim);
        } else {
          animFrameRef.current = null;
        }
      };

      animFrameRef.current = requestAnimationFrame(stepAnim);
    },
    [avatarType]
  );

  const identifyCurrentPlaceName = useCallback(async (lat, lng) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
      );
      const data = await res.json();
      const addr = data?.address || {};
      const road = addr.road || addr.suburb || addr.village || addr.town || addr.city;
      const city = addr.city || addr.town || addr.county || addr.state_district;
      const parts = [road, city].filter(Boolean);
      const label = parts.length > 0 ? parts.join(', ') : 'Your location';

      setDetectedAddress(label);
      setOrigin((prev) =>
        !prev || prev.id === 'gps-current'
          ? {
              id: 'gps-current',
              name: 'Your location',
              area: label,
              lat,
              lng
            }
          : prev
      );
    } catch {
      // Keep fallback
    }
  }, []);

  const requestMobileLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocationStatus('unavailable');
      setLocationErrorMsg('Location services are not supported on this device or browser.');
      return;
    }

    setLocationStatus('requesting');
    setLocationErrorMsg('');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading } = pos.coords;
        const gpsPlace = {
          id: 'gps-current',
          name: 'Your location',
          area: detectedAddress,
          lat: latitude,
          lng: longitude
        };

        setLiveCoords({ lat: latitude, lng: longitude, accuracy, heading });
        setOrigin(gpsPlace);
        setFromText('Your location');
        setLocationStatus('granted');
        identifyCurrentPlaceName(latitude, longitude);

        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }

        watchIdRef.current = navigator.geolocation.watchPosition(
          (watchPos) => {
            const nextLat = watchPos.coords.latitude;
            const nextLng = watchPos.coords.longitude;
            setLiveCoords({
              lat: nextLat,
              lng: nextLng,
              accuracy: watchPos.coords.accuracy,
              heading: watchPos.coords.heading
            });
            setOrigin((prev) =>
              !prev || prev.id === 'gps-current'
                ? {
                    id: 'gps-current',
                    name: 'Your location',
                    area: detectedAddress,
                    lat: nextLat,
                    lng: nextLng
                  }
                : prev
            );
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setLocationStatus('denied');
          setLocationErrorMsg(
            'Location permission was denied. Please turn ON Location Services on your phone and allow location access.'
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setLocationStatus('denied');
          setLocationErrorMsg(
            'Your phone GPS signal is unavailable. Please turn ON your mobile Location / GPS toggle and tap Retry.'
          );
        } else if (err.code === err.TIMEOUT) {
          setLocationStatus('denied');
          setLocationErrorMsg(
            'Location request timed out. Make sure mobile GPS / Location is switched ON and tap Retry.'
          );
        } else {
          setLocationStatus('denied');
          setLocationErrorMsg(err.message || 'Unable to detect mobile location.');
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }, [detectedAddress, identifyCurrentPlaceName]);

  useEffect(() => {
    let cancelled = false;
    async function checkPermission() {
      if (!('geolocation' in navigator)) {
        setLocationStatus('unavailable');
        return;
      }
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const status = await navigator.permissions.query({ name: 'geolocation' });
          if (cancelled) return;
          if (status.state === 'granted') {
            requestMobileLocation();
          }
        }
      } catch {
        // Ignore
      }
    }
    checkPermission();
    return () => {
      cancelled = true;
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [requestMobileLocation]);

  // Live search suggestions across Sri Lanka via Nominatim
  useEffect(() => {
    if (!activeTab) {
      setSuggestions([]);
      return;
    }

    const query = activeTab === 'from' ? fromText : toText;
    const cleanQuery = query.replace(/,\s*sri lanka$/i, '').trim();

    const baseList =
      activeTab === 'from' && liveCoords
        ? [
            {
              id: 'gps-current',
              name: 'Your location',
              area: detectedAddress,
              lat: liveCoords.lat,
              lng: liveCoords.lng
            }
          ]
        : [];

    if (!cleanQuery || cleanQuery.toLowerCase() === 'your location') {
      setSuggestions(baseList);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&countrycodes=lk&limit=8&q=${encodeURIComponent(cleanQuery)}`
        );
        const data = await res.json();
        if (!Array.isArray(data)) {
          setSuggestions(baseList);
          return;
        }

        const seen = new Set(baseList.map((x) => x.name.toLowerCase()));
        const apiHits = [];

        data.forEach((item) => {
          const parts = item.display_name
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s && s.toLowerCase() !== 'sri lanka');
          const placeTitle = parts[0] || item.display_name;
          const key = placeTitle.toLowerCase();

          if (!seen.has(key)) {
            seen.add(key);
            apiHits.push({
              id: `lk-${item.place_id}`,
              name: placeTitle,
              area: parts[1] ? `${parts[1]} · Sri Lanka` : 'Sri Lanka',
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon)
            });
          }
        });

        setSuggestions([...baseList, ...apiHits].slice(0, 10));
      } catch {
        setSuggestions(baseList);
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [activeTab, fromText, toText, liveCoords, detectedAddress]);

  // Initialize Leaflet map centered on user's live GPS location
  useEffect(() => {
    if (locationStatus !== 'granted' || !mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter = liveCoords ? [liveCoords.lat, liveCoords.lng] : [6.8018, 79.9227];

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 15,
      zoomControl: false
    });

    const streetsLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    tileLayerRef.current = streetsLayer;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [locationStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active road alerts from last 24h (auto-deleted after 1 day)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (alertMarkersLayerRef.current) {
      map.removeLayer(alertMarkersLayerRef.current);
      alertMarkersLayerRef.current = null;
    }

    if (!showTrafficOnMap) return;

    const freshAlerts = roadAlerts.filter((a) => isWithinOneDay(a.created_at));
    if (!freshAlerts.length) return;

    const group = L.layerGroup().addTo(map);
    freshAlerts.forEach((alert) => {
      const cfg = REPORT_TYPES[alert.alert_type] || REPORT_TYPES.police;
      const marker = L.marker([alert.lat, alert.lng], {
        icon: createAlertPinIcon(alert.alert_type),
        zIndexOffset: 900
      }).bindPopup(`<strong>${cfg.label}</strong><br/><span style="color:#64748b;">Auto-deletes after 24h</span>`);
      marker.addTo(group);
    });
    alertMarkersLayerRef.current = group;
  }, [roadAlerts, showTrafficOnMap, locationStatus]);

  // Fetch OSRM routes + alternative roads
  const runRouteRequest = useCallback(
    async (fromPoint, toPoint, { isReroute = false } = {}) => {
      if (!fromPoint || !toPoint) return;

      if (!isReroute) setLoadingRoute(true);
      setRouteError('');

      try {
        const profile = MODE_CONFIG[travelMode]?.profile || 'driving';
        const coords = `${fromPoint.lng},${fromPoint.lat};${toPoint.lng},${toPoint.lat}`;
        const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&alternatives=3&steps=true`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Routing error (${res.status})`);

        const data = await res.json();
        if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
          throw new Error('No road route found.');
        }

        let bestIdx = 0;
        let bestScore = Infinity;
        data.routes.forEach((route, idx) => {
          const score = route.duration + route.distance * 0.012;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
        });

        setRoutes(data.routes);
        setBestIndex(bestIdx);
        setSelectedIndex(bestIdx);
        announcedStepRef.current = -1;
        setActiveStepIndex(0);

        if (isReroute) {
          const msg = `Off route — redirected to ${ensureSriLankaLabel(toPoint.name)}.`;
          setRerouteNotice(msg);
          speakInstruction(msg);
          setTimeout(() => setRerouteNotice(''), 5500);
        }
      } catch (err) {
        if (!isReroute) {
          setRoutes([]);
          setRouteError(err?.message || 'Unable to fetch route.');
        }
      } finally {
        if (!isReroute) setLoadingRoute(false);
      }
    },
    [travelMode, speakInstruction]
  );

  useEffect(() => {
    if (locationStatus === 'granted' && origin && destination && screenMode !== 'navigating') {
      runRouteRequest(origin, destination, { isReroute: false });
    }
  }, [origin, destination, travelMode, locationStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real physical GPS movement handler: moves ONLY when real GPS position changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !liveCoords) return;

    const isNavMode = screenMode === 'navigating';
    const currentRoute = routes[selectedIndex] || routes[bestIndex];
    const routeCoords = currentRoute?.geometry?.coordinates || [];
    const routeSteps = currentRoute?.legs?.[0]?.steps || [];

    let targetLat = liveCoords.lat;
    let targetLng = liveCoords.lng;
    let bearing = liveCoords.heading || 0;

    if (prevGpsRef.current) {
      const movedDist = getDistanceMeters(
        prevGpsRef.current.lat,
        prevGpsRef.current.lng,
        liveCoords.lat,
        liveCoords.lng
      );
      if (movedDist > 2) {
        bearing = calculateBearing(
          prevGpsRef.current.lat,
          prevGpsRef.current.lng,
          liveCoords.lat,
          liveCoords.lng
        );
      }
    }

    if (isNavMode && routeCoords.length > 0) {
      const snapped = snapToRouteSegment(liveCoords.lat, liveCoords.lng, routeCoords);
      targetLat = snapped.snappedLat;
      targetLng = snapped.snappedLng;

      const now = Date.now();
      if (
        snapped.distanceMeters > 70 &&
        destination &&
        now - lastRerouteTimeRef.current > 7000
      ) {
        lastRerouteTimeRef.current = now;
        runRouteRequest(
          {
            id: 'gps-current',
            name: 'Your location',
            area: detectedAddress,
            lat: liveCoords.lat,
            lng: liveCoords.lng
          },
          destination,
          { isReroute: true }
        );
      }

      if (routeSteps.length > 0) {
        let closestStepIdx = 0;
        let minStepDist = Infinity;
        routeSteps.forEach((st, idx) => {
          const loc = st?.maneuver?.location;
          if (Array.isArray(loc) && loc.length >= 2) {
            const d = getDistanceMeters(liveCoords.lat, liveCoords.lng, loc[1], loc[0]);
            if (d < minStepDist) {
              minStepDist = d;
              closestStepIdx = idx;
            }
          }
        });
        const nextIdx =
          minStepDist < 40 && closestStepIdx + 1 < routeSteps.length
            ? closestStepIdx + 1
            : closestStepIdx;
        setActiveStepIndex(nextIdx);
        if (nextIdx !== announcedStepRef.current) {
          announcedStepRef.current = nextIdx;
          const meta = getTurnMeta(routeSteps[nextIdx], destination?.name || 'Sri Lanka');
          speakInstruction(meta.stepTitle);
        }
      }
    }

    prevGpsRef.current = { lat: liveCoords.lat, lng: liveCoords.lng };

    if (!userNavMarkerRef.current) {
      renderedPosRef.current = { lat: targetLat, lng: targetLng };
      userNavMarkerRef.current = L.marker([targetLat, targetLng], {
        icon: createVehicleIcon(bearing, avatarType),
        zIndexOffset: 1000
      }).addTo(map);
    } else {
      smoothlyMoveMarkerTo(targetLat, targetLng, bearing, isNavMode);
    }
  }, [
    liveCoords,
    detectedAddress,
    destination,
    screenMode,
    routes,
    selectedIndex,
    bestIndex,
    avatarType,
    runRouteRequest,
    speakInstruction,
    smoothlyMoveMarkerTo
  ]);

  // Map style switch (Streets vs Satellite + Roads)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }
    if (roadLabelOverlayRef.current) {
      map.removeLayer(roadLabelOverlayRef.current);
      roadLabelOverlayRef.current = null;
    }

    if (mapStyle === 'satellite') {
      tileLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: 'Tiles &copy; Esri' }
      ).addTo(map);

      roadLabelOverlayRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, opacity: 0.92 }
      ).addTo(map);
    } else {
      tileLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
    }
  }, [mapStyle]);

  // Destination pin & origin dot (only when user searches/selects a destination)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (endMarkerRef.current) {
      map.removeLayer(endMarkerRef.current);
      endMarkerRef.current = null;
    }
    if (startMarkerRef.current) {
      map.removeLayer(startMarkerRef.current);
      startMarkerRef.current = null;
    }

    if (!destination) return;

    const redPinIcon = L.divIcon({
      className: 'dest-red-pin',
      html: `<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;background:#dc2626;border:2.5px solid #ffffff;transform:rotate(-45deg);box-shadow:0 3px 8px rgba(0,0,0,0.35);"></div>`,
      iconSize: [24, 28],
      iconAnchor: [12, 24]
    });

    endMarkerRef.current = L.marker([destination.lat, destination.lng], {
      icon: redPinIcon,
      zIndexOffset: 850
    })
      .addTo(map)
      .bindPopup(`<strong>${ensureSriLankaLabel(destination.name)}</strong>`);

    if (screenMode === 'directions' && origin) {
      const originRing = L.divIcon({
        className: 'origin-ring-pin',
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#ffffff;border:3px solid #0f172a;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      startMarkerRef.current = L.marker([origin.lat, origin.lng], { icon: originRing }).addTo(map);
    }
  }, [origin, destination, screenMode, locationStatus]);

  // Route polylines + time badges
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    routeLayersRef.current.forEach((l) => map.removeLayer(l));
    routeLayersRef.current = [];
    routeTimeBadgesRef.current.forEach((b) => map.removeLayer(b));
    routeTimeBadgesRef.current = [];

    if (!routes.length || screenMode === 'explore') return;

    const allCoords = [];

    routes.forEach((route, idx) => {
      const latLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const isSelected = idx === selectedIndex;

      const line = L.polyline(latLngs, {
        color: isSelected ? '#1d4ed8' : '#818cf8',
        weight: isSelected ? 7 : 5,
        opacity: isSelected ? 0.96 : 0.72
      }).addTo(map);

      line.on('click', () => setSelectedIndex(idx));
      routeLayersRef.current.push(line);
      allCoords.push(...latLngs);

      if (screenMode === 'directions' && latLngs.length > 2) {
        const mid = latLngs[Math.floor(latLngs.length * (idx === selectedIndex ? 0.35 : 0.65))];
        const badgeIcon = L.divIcon({
          className: 'route-eta-badge',
          html: `<div style="background:${isSelected ? '#1d4ed8' : '#ffffff'};color:${isSelected ? '#ffffff' : '#0f172a'};border:1.5px solid ${isSelected ? '#1d4ed8' : '#cbd5e1'};border-radius:999px;padding:3px 9px;font-size:12px;font-weight:800;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.2);">${formatDuration(route.duration)}</div>`,
          iconSize: [64, 24],
          iconAnchor: [32, 12]
        });
        const badge = L.marker(mid, { icon: badgeIcon, interactive: false }).addTo(map);
        badge.on('click', () => setSelectedIndex(idx));
        routeTimeBadgesRef.current.push(badge);
      }
    });

    if (screenMode === 'directions' && allCoords.length > 0) {
      map.fitBounds(L.latLngBounds(allCoords), { padding: [55, 45] });
    }
  }, [routes, selectedIndex, bestIndex, screenMode]);

  const applyPlaceToTab = (place, tab) => {
    if (tab === 'from') {
      setOrigin(place);
      setFromText(place.name);
    } else {
      setDestination(place);
      setToText(place.name);
      if (mapInstanceRef.current && screenMode === 'explore') {
        mapInstanceRef.current.setView([place.lat, place.lng], 15, { animate: true });
      }
    }
    setActiveTab(null);
  };

  const resolveTypedPlace = async (rawValue, tab) => {
    const trimmed = rawValue.trim();
    if (!trimmed) return;

    const cleanName = trimmed.replace(/,\s*sri lanka$/i, '').trim();

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=lk&limit=1&q=${encodeURIComponent(cleanName)}`
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        const parts = item.display_name
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && s.toLowerCase() !== 'sri lanka');
        applyPlaceToTab(
          {
            id: `lk-${item.place_id}`,
            name: parts[0] || cleanName,
            area: parts[1] ? `${parts[1]} · Sri Lanka` : 'Sri Lanka',
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon)
          },
          tab
        );
      }
    } catch {
      // Ignore
    }
  };

  const handleChipClick = (chip) => {
    handleSelectReportType(chip.id);
  };

  const handleOpenDirections = () => {
    if (!destination) return;
    setActiveTab(null);
    setScreenMode('directions');
    if (locationStatus === 'granted' && origin) {
      runRouteRequest(origin, destination, { isReroute: false });
    }
  };

  const handleSwap = () => {
    if (!origin || !destination) return;
    const prevOrigin = origin;
    const prevDest = destination;
    setOrigin(prevDest);
    setDestination(prevOrigin);
    setFromText(prevDest.name);
    setToText(prevOrigin.name);
    setActiveTab(null);
  };

  const handleStartNavigation = async () => {
    if (!destination) return;
    if (!routes.length && origin) {
      await runRouteRequest(origin, destination, { isReroute: false });
    }
    setActiveTab(null);
    setReportModalStage('closed');
    setRerouteNotice('');
    announcedStepRef.current = 0;
    setActiveStepIndex(0);
    setScreenMode('navigating');

    const focusLat = liveCoords?.lat ?? origin?.lat;
    const focusLng = liveCoords?.lng ?? origin?.lng;
    if (mapInstanceRef.current && typeof focusLat === 'number' && typeof focusLng === 'number') {
      mapInstanceRef.current.setView([focusLat, focusLng], 17, { animate: true });
    }
  };

  const handleStopNavigation = () => {
    setScreenMode('directions');
    setReportModalStage('closed');
    setRerouteNotice('');
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleRecentre = () => {
    const map = mapInstanceRef.current;
    const focusLat = liveCoords?.lat ?? origin?.lat;
    const focusLng = liveCoords?.lng ?? origin?.lng;
    if (map && typeof focusLat === 'number' && typeof focusLng === 'number') {
      map.setView([focusLat, focusLng], 17, { animate: true });
    }
  };

  const handleSharePlace = async () => {
    if (!destination) return;
    const label = `${ensureSriLankaLabel(destination.name)} (${destination.lat.toFixed(4)}, ${destination.lng.toFixed(4)})`;
    try {
      if (navigator.share) {
        await navigator.share({ title: destination.name, text: label });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(label);
        alert(`Copied location: ${label}`);
      }
    } catch {
      // Cancelled
    }
  };

  const handleFocusStep = (step, idx) => {
    setActiveStepIndex(idx);
    const map = mapInstanceRef.current;
    const loc = step?.maneuver?.location;
    if (map && Array.isArray(loc) && loc.length >= 2) {
      map.setView([loc[1], loc[0]], 17, { animate: true });
    }
  };

  const handleSubscribeSubmit = async (e) => {
    e.preventDefault();
    if (!subscriberName.trim() || !subscriberEmail.trim()) {
      alert('Please enter both your name and email.');
      return;
    }
    setSubscribing(true);
    try {
      const { error } = await supabase
        .from('subscribers')
        .insert([{ name: subscriberName.trim(), email: subscriberEmail.trim() }]);
      if (error) {
        alert(error.code === '23505' ? 'Already subscribed!' : 'Subscription failed: ' + error.message);
      } else {
        alert('Successfully subscribed to Lanka Stay!');
        setSubscriberName('');
        setSubscriberEmail('');
      }
    } finally {
      setSubscribing(false);
    }
  };

  const activeRoute = routes[selectedIndex] || routes[bestIndex] || null;
  const steps = activeRoute?.legs?.[0]?.steps || [];
  const currentStep = steps[activeStepIndex] || steps[0] || null;
  const currentStepMeta = currentStep
    ? getTurnMeta(currentStep, destination?.name || 'Sri Lanka')
    : {
        stepTitle: `Head towards ${ensureSriLankaLabel(destination?.name)}`,
        towardsText: ensureSriLankaLabel(destination?.name),
        thenIcon: 'fa-arrow-turn-right',
        icon: 'fa-arrow-up'
      };
  const nextStep = steps[activeStepIndex + 1] || null;
  const nextStepMeta = nextStep
    ? getTurnMeta(nextStep, destination?.name || 'Sri Lanka')
    : null;

  const totalDurationSec = activeRoute?.duration ?? 0;
  const totalDistanceM = activeRoute?.distance ?? 0;
  const freshAlertsCount = roadAlerts.filter((a) => isWithinOneDay(a.created_at)).length;

  return (
    <main className="screen" style={{ width: '100%', boxSizing: 'border-box', borderRadius: '0px', padding: 0 }}>
      {locationStatus !== 'granted' ? (
        <section
          style={{
            minHeight: '72vh',
            background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 16px'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '400px',
              background: '#ffffff',
              color: '#0f172a',
              borderRadius: '20px',
              padding: '24px 20px',
              textAlign: 'center',
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)'
            }}
          >
            <div
              style={{
                width: '58px',
                height: '58px',
                borderRadius: '50%',
                background: '#eff6ff',
                color: '#1d4ed8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem',
                margin: '0 auto 12px'
              }}
            >
              <i className="fa-solid fa-location-crosshairs"></i>
            </div>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 8px' }}>Enable Location</h2>
            <p style={{ fontSize: '0.86rem', color: '#475569', margin: '0 0 14px', lineHeight: 1.45 }}>
              Turn on location to see Sri Lanka roads, search places, track your live movement, and report road alerts.
            </p>
            {locationErrorMsg && (
              <div
                style={{
                  background: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                  borderRadius: '10px',
                  padding: '9px 11px',
                  fontSize: '0.78rem',
                  marginBottom: '12px',
                  textAlign: 'left'
                }}
              >
                {locationErrorMsg}
              </div>
            )}
            <button
              type="button"
              onClick={requestMobileLocation}
              disabled={locationStatus === 'requesting'}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '999px',
                border: 'none',
                background: '#1d4ed8',
                color: '#ffffff',
                fontSize: '0.92rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {locationStatus === 'requesting' ? 'Locating...' : 'Turn On Location'}
            </button>
          </div>
        </section>
      ) : (
        <div style={{ position: 'relative', width: '100%', background: '#ffffff' }}>
          {/* MAP CONTAINER */}
          <div style={{ position: 'relative', width: '100%', height: screenMode === 'navigating' ? '300px' : '380px', background: '#e2e8f0' }}>
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%', zIndex: 1 }} />

            {/* EMPTY SEARCH BAR ON EXPLORE OVERLAY */}
            {screenMode === 'explore' && (
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  left: '12px',
                  right: '12px',
                  zIndex: 550
                }}
              >
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '999px',
                    padding: '10px 16px',
                    boxShadow: '0 4px 16px rgba(15, 23, 42, 0.16)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <i className="fa-solid fa-magnifying-glass" style={{ color: '#334155', fontSize: '0.95rem' }}></i>
                  <input
                    type="text"
                    value={toText}
                    placeholder="Search any place in Sri Lanka..."
                    onFocus={() => setActiveTab('explore')}
                    onChange={(e) => {
                      setToText(e.target.value);
                      setActiveTab('explore');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        resolveTypedPlace(toText, 'to');
                      }
                    }}
                    style={{
                      flex: 1,
                      border: 'none',
                      outline: 'none',
                      fontSize: '0.95rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      background: 'transparent'
                    }}
                  />
                  {toText && (
                    <button
                      type="button"
                      onClick={() => {
                        setToText('');
                        setSuggestions([]);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#475569',
                        fontSize: '1rem',
                        cursor: 'pointer',
                        padding: '2px 6px'
                      }}
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  )}
                </div>

                {/* Alert Chips */}
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    overflowX: 'auto',
                    marginTop: '10px',
                    paddingBottom: '4px'
                  }}
                >
                  {QUICK_CHIPS.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => handleChipClick(chip)}
                      style={{
                        background: '#ffffff',
                        color: '#0f172a',
                        border: 'none',
                        borderRadius: '999px',
                        padding: '8px 13px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        boxShadow: '0 2px 10px rgba(15, 23, 42, 0.14)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <i className={`fa-solid ${chip.icon}`} style={{ color: '#475569' }}></i>
                      <span>{chip.label}</span>
                    </button>
                  ))}
                </div>

                {/* Search Suggestions Dropdown */}
                {activeTab === 'explore' && suggestions.length > 0 && (
                  <div
                    style={{
                      marginTop: '6px',
                      background: '#ffffff',
                      borderRadius: '14px',
                      boxShadow: '0 10px 25px rgba(15, 23, 42, 0.2)',
                      maxHeight: '210px',
                      overflowY: 'auto'
                    }}
                  >
                    {suggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => applyPlaceToTab(item, 'to')}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 14px',
                          background: '#ffffff',
                          border: 'none',
                          borderBottom: '1px solid #f1f5f9',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                      >
                        <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0f172a' }}>{item.name}</span>
                        <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{item.area}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* DIRECTIONS OVERLAY: From & To Inputs */}
            {screenMode === 'directions' && (
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  right: '10px',
                  zIndex: 550,
                  background: '#ffffff',
                  borderRadius: '18px',
                  padding: '12px 14px',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setScreenMode('explore')}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#0f172a',
                      fontSize: '1rem',
                      cursor: 'pointer',
                      padding: '4px'
                    }}
                  >
                    <i className="fa-solid fa-arrow-left"></i>
                  </button>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#2563eb', flexShrink: 0 }}></span>
                      <input
                        type="text"
                        value={fromText}
                        onFocus={() => setActiveTab('from')}
                        onChange={(e) => {
                          setFromText(e.target.value);
                          setActiveTab('from');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            resolveTypedPlace(fromText, 'from');
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: '10px',
                          border: '1px solid #e2e8f0',
                          fontSize: '0.88rem',
                          fontWeight: 600,
                          color: '#0f172a',
                          background: '#f8fafc'
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <i className="fa-solid fa-location-dot" style={{ color: '#dc2626', fontSize: '0.85rem', width: '10px', flexShrink: 0 }}></i>
                      <input
                        type="text"
                        value={toText}
                        placeholder="Destination"
                        onFocus={() => setActiveTab('to')}
                        onChange={(e) => {
                          setToText(e.target.value);
                          setActiveTab('to');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            resolveTypedPlace(toText, 'to');
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          borderRadius: '10px',
                          border: '1px solid #e2e8f0',
                          fontSize: '0.88rem',
                          fontWeight: 600,
                          color: '#0f172a',
                          background: '#f8fafc'
                        }}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSwap}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#0f172a',
                      fontSize: '1rem',
                      cursor: 'pointer',
                      padding: '6px'
                    }}
                  >
                    <i className="fa-solid fa-arrow-up-arrow-down"></i>
                  </button>
                </div>

                {activeTab && suggestions.length > 0 && (
                  <div
                    style={{
                      marginTop: '8px',
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      maxHeight: '180px',
                      overflowY: 'auto'
                    }}
                  >
                    {suggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => applyPlaceToTab(item, activeTab)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 12px',
                          background: '#ffffff',
                          border: 'none',
                          borderBottom: '1px solid #f1f5f9',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between'
                        }}
                      >
                        <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0f172a' }}>{item.name}</span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{item.area}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ACTIVE STEP NAVIGATION TOP BANNER */}
            {screenMode === 'navigating' && (
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  right: '10px',
                  zIndex: 560
                }}
              >
                <div
                  style={{
                    background: '#064e3b',
                    color: '#ffffff',
                    borderRadius: '14px',
                    padding: '10px 14px',
                    boxShadow: '0 8px 22px rgba(0, 0, 0, 0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px'
                  }}
                >
                  <div style={{ textAlign: 'center', minWidth: '46px' }}>
                    <div style={{ fontSize: '1.5rem', lineHeight: 1 }}>
                      <i className={`fa-solid ${currentStepMeta.icon}`}></i>
                    </div>
                    {currentStep && (
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, marginTop: '3px' }}>
                        {formatDistance(currentStep.distance)}
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.76rem', color: '#a7f3d0', fontWeight: 600 }}>towards</div>
                    <div
                      style={{
                        fontSize: '1.2rem',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {currentStepMeta.towardsText}
                    </div>
                  </div>
                </div>

                {nextStepMeta && (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '7px',
                      background: '#064e3b',
                      color: '#ffffff',
                      padding: '5px 11px',
                      borderRadius: '10px',
                      marginTop: '6px',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.28)'
                    }}
                  >
                    <span>Then</span>
                    <i className={`fa-solid ${nextStepMeta.thenIcon}`}></i>
                  </div>
                )}

                {rerouteNotice && (
                  <div
                    style={{
                      marginTop: '6px',
                      background: '#0f172a',
                      color: '#ffffff',
                      borderRadius: '10px',
                      padding: '6px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 700
                    }}
                  >
                    {rerouteNotice}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT UNDER THE MAP: DIRECTIONS & START ACTION BAR */}
          <div
            style={{
              padding: '12px 16px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleOpenDirections}
                disabled={!destination}
                style={{
                  background: destination ? '#115e59' : '#94a3b8',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '999px',
                  padding: '10px 18px',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  cursor: destination ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <i className="fa-solid fa-diamond-turn-right"></i>
                <span>Directions</span>
              </button>

              {screenMode !== 'navigating' ? (
                <button
                  type="button"
                  onClick={handleStartNavigation}
                  disabled={!destination}
                  style={{
                    background: destination ? '#e0f2fe' : '#f1f5f9',
                    color: destination ? '#0f172a' : '#94a3b8',
                    border: 'none',
                    borderRadius: '999px',
                    padding: '10px 18px',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    cursor: destination ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <i className="fa-solid fa-location-arrow" style={{ color: '#0d9488' }}></i>
                  <span>Start</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStopNavigation}
                  style={{
                    background: '#fee2e2',
                    color: '#991b1b',
                    border: 'none',
                    borderRadius: '999px',
                    padding: '10px 18px',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <i className="fa-solid fa-xmark"></i>
                  <span>Stop</span>
                </button>
              )}

              {destination && (
                <button
                  type="button"
                  onClick={handleSharePlace}
                  style={{
                    background: '#f1f5f9',
                    color: '#0f172a',
                    border: 'none',
                    borderRadius: '999px',
                    padding: '10px 15px',
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '7px'
                  }}
                >
                  <i className="fa-solid fa-share-nodes"></i>
                  <span>Share</span>
                </button>
              )}
            </div>

            <span style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 600 }}>
              {freshAlertsCount} alerts (24h)
            </span>
          </div>

          {/* EXPLORE DETAILS & AUTOMATICALLY FETCHED PLACE PHOTOS */}
          {screenMode === 'explore' && destination && (
            <section style={{ padding: '14px 16px 20px', background: '#ffffff' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: '1.35rem', fontWeight: 700, color: '#0f172a' }}>
                {destination.name}
              </h2>
              <div style={{ fontSize: '0.86rem', color: '#475569', marginBottom: '12px', fontWeight: 600 }}>
                {destination.area}
                {activeRoute ? ` · ${formatDuration(totalDurationSec)} (${formatDistance(totalDistanceM)})` : ''}
              </div>

              {loadingPhotos ? (
                <div style={{ fontSize: '0.84rem', color: '#475569', padding: '12px 0' }}>
                  Fetching photos for {destination.name}...
                </div>
              ) : (
                placePhotos.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: placePhotos.length > 1 ? '1.4fr 1fr' : '1fr', gap: '8px' }}>
                    <img
                      src={placePhotos[0]}
                      alt={destination.name}
                      style={{ width: '100%', height: '210px', objectFit: 'cover', borderRadius: '14px' }}
                    />
                    {placePhotos.length > 1 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {placePhotos.slice(1, 3).map((imgUrl, idx) => (
                          <img
                            key={idx}
                            src={imgUrl}
                            alt={`${destination.name} ${idx + 2}`}
                            style={{ width: '100%', height: '101px', objectFit: 'cover', borderRadius: '12px' }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}
            </section>
          )}

          {/* DIRECTIONS VIEW: MODE SWITCHER & ALL TURN-BY-TURN STEPS */}
          {screenMode === 'directions' && (
            <section style={{ padding: '14px 16px 20px', background: '#ffffff' }}>
              <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '12px' }}>
                {Object.entries(MODE_CONFIG).map(([key, cfg]) => {
                  const active = travelMode === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTravelMode(key)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        borderBottom: active ? '3px solid #115e59' : '3px solid transparent',
                        padding: '4px 6px',
                        color: active ? '#115e59' : '#475569',
                        fontSize: '0.88rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <i className={`fa-solid ${cfg.icon}`}></i>
                      <span>{key === travelMode && activeRoute ? formatDuration(totalDurationSec) : cfg.label}</span>
                    </button>
                  );
                })}
              </div>

              {loadingRoute && <div style={{ fontSize: '0.84rem', color: '#475569', marginBottom: '10px' }}>Loading routes...</div>}
              {routeError && <div style={{ fontSize: '0.84rem', color: '#dc2626', marginBottom: '10px' }}>{routeError}</div>}

              {activeRoute && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                    {formatDuration(totalDurationSec)} ({formatDistance(totalDistanceM)})
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                    {selectedIndex === bestIndex ? 'Fastest route' : `Alternative road ${selectedIndex + 1}`}
                  </div>
                </div>
              )}

              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>Steps</h4>

                <div
                  onClick={handleRecentre}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 4px',
                    borderBottom: '1px solid #e2e8f0',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#2563eb' }}></span>
                  <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>Your location</span>
                </div>

                {steps.map((step, idx) => {
                  const meta = getTurnMeta(step, destination?.name || 'Sri Lanka');
                  return (
                    <div
                      key={idx}
                      onClick={() => handleFocusStep(step, idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        padding: '11px 4px',
                        borderBottom: '1px solid #e2e8f0',
                        cursor: 'pointer'
                      }}
                    >
                      <span style={{ width: '20px', textAlign: 'center', color: '#0f172a', marginTop: '2px' }}>
                        <i className={`fa-solid ${meta.icon}`}></i>
                      </span>
                      <div>
                        <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>
                          {meta.stepTitle}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                          {formatDistance(step.distance)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ACTIVE NAVIGATION SHEET WHEN START IS CLICKED */}
          {screenMode === 'navigating' && (
            <section style={{ background: '#ffffff' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderBottom: '1px solid #e2e8f0'
                }}
              >
                <div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#15803d' }}>
                    {formatDuration(totalDurationSec)}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>
                    {formatDistance(totalDistanceM)} · {formatArrivalTime(totalDurationSec)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRecentre}
                  style={{
                    background: '#f1f5f9',
                    color: '#0f172a',
                    border: 'none',
                    borderRadius: '999px',
                    padding: '8px 14px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <i className="fa-solid fa-location-arrow" style={{ color: '#0d9488', marginRight: '6px' }}></i>
                  Re-centre
                </button>
              </div>

              <div style={{ padding: '4px 16px 18px' }}>
                <button
                  type="button"
                  onClick={() => setReportModalStage('grid')}
                  style={{
                    width: '100%',
                    padding: '13px 4px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    fontSize: '0.98rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '1.15rem', width: '24px' }}></i>
                  <span>Add a report</span>
                </button>

                <button
                  type="button"
                  onClick={handleSharePlace}
                  style={{
                    width: '100%',
                    padding: '13px 4px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.98rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <i className="fa-solid fa-share-nodes" style={{ fontSize: '1.15rem', width: '24px' }}></i>
                    <span>Share trip progress</span>
                  </span>
                  <span
                    style={{
                      background: '#bbf7d0',
                      color: '#166534',
                      borderRadius: '8px',
                      padding: '2px 8px',
                      fontSize: '0.75rem',
                      fontWeight: 700
                    }}
                  >
                    New
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setScreenMode('directions')}
                  style={{
                    width: '100%',
                    padding: '13px 4px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    fontSize: '0.98rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <i className="fa-solid fa-list" style={{ fontSize: '1.15rem', width: '24px' }}></i>
                  <span>Directions</span>
                </button>

                <div
                  onClick={() => setShowTrafficOnMap((v) => !v)}
                  style={{
                    padding: '13px 4px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.98rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <i className="fa-solid fa-traffic-light" style={{ fontSize: '1.15rem', width: '24px' }}></i>
                    <span>Show traffic on map</span>
                  </span>
                  <span
                    style={{
                      width: '44px',
                      height: '24px',
                      borderRadius: '999px',
                      background: showTrafficOnMap ? '#115e59' : '#cbd5e1',
                      padding: '2px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: showTrafficOnMap ? 'flex-end' : 'flex-start'
                    }}
                  >
                    <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#ffffff' }}></span>
                  </span>
                </div>

                <div
                  onClick={() => setMapStyle((s) => (s === 'streets' ? 'satellite' : 'streets'))}
                  style={{
                    padding: '13px 4px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.98rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <i className="fa-solid fa-image" style={{ fontSize: '1.15rem', width: '24px' }}></i>
                    <span>Show satellite map</span>
                  </span>
                  <span
                    style={{
                      width: '44px',
                      height: '24px',
                      borderRadius: '999px',
                      background: mapStyle === 'satellite' ? '#115e59' : '#cbd5e1',
                      padding: '2px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: mapStyle === 'satellite' ? 'flex-end' : 'flex-start'
                    }}
                  >
                    <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#ffffff' }}></span>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setAvatarType((prev) => (prev === 'arrow' ? 'bike' : 'arrow'))}
                  style={{
                    width: '100%',
                    padding: '13px 4px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.98rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <i className="fa-solid fa-motorcycle" style={{ fontSize: '1.15rem', width: '24px' }}></i>
                    <span>Driving avatar</span>
                  </span>
                  <span
                    style={{
                      background: '#bbf7d0',
                      color: '#166534',
                      borderRadius: '8px',
                      padding: '2px 8px',
                      fontSize: '0.75rem',
                      fontWeight: 700
                    }}
                  >
                    {avatarType === 'bike' ? 'Bike ON' : 'New'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setVoiceEnabled((v) => !v)}
                  style={{
                    width: '100%',
                    padding: '13px 4px',
                    background: 'transparent',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.98rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <i className="fa-solid fa-gear" style={{ fontSize: '1.15rem', width: '24px' }}></i>
                    <span>Settings · Voice</span>
                  </span>
                  <span style={{ fontSize: '0.84rem', color: '#475569', fontWeight: 700 }}>
                    {voiceEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            </section>
          )}

          {/* ADD A REPORT MODAL */}
          {reportModalStage === 'grid' && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 900,
                background: 'rgba(15, 23, 42, 0.45)',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center'
              }}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: '480px',
                  background: '#ffffff',
                  borderTopLeftRadius: '24px',
                  borderTopRightRadius: '24px',
                  padding: '18px 16px 24px',
                  boxShadow: '0 -8px 28px rgba(0, 0, 0, 0.25)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>Add a report</h3>
                  <button
                    type="button"
                    onClick={() => setReportModalStage('closed')}
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      border: 'none',
                      background: '#f1f5f9',
                      color: '#334155',
                      fontSize: '1rem',
                      cursor: 'pointer'
                    }}
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                  {Object.entries(REPORT_TYPES).map(([key, cfg]) => {
                    const iconColor = cfg.color === '#eab308' ? '#0f172a' : '#ffffff';
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleSelectReportType(key)}
                        style={{
                          background: '#f1f5f9',
                          border: 'none',
                          borderRadius: '16px',
                          padding: '16px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '10px'
                        }}
                      >
                        <span
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '50%',
                            background: cfg.color,
                            color: iconColor,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1.2rem'
                          }}
                        >
                          <i className={`fa-solid ${cfg.icon}`}></i>
                        </span>
                        <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* REPORTING CONFIRMATION SHEET WITH UNDO & DONE */}
          {reportModalStage === 'confirming' && pendingReport && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 910,
                background: 'rgba(15, 23, 42, 0.25)',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center'
              }}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: '480px',
                  background: '#ffffff',
                  borderTopLeftRadius: '24px',
                  borderTopRightRadius: '24px',
                  padding: '18px 16px 24px',
                  boxShadow: '0 -8px 24px rgba(0, 0, 0, 0.22)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <span
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: REPORT_TYPES[pendingReport.alert_type]?.color || '#2563eb',
                      color:
                        (REPORT_TYPES[pendingReport.alert_type]?.color || '#2563eb') === '#eab308'
                          ? '#0f172a'
                          : '#ffffff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.9rem'
                    }}
                  >
                    <i className={`fa-solid ${REPORT_TYPES[pendingReport.alert_type]?.icon || 'fa-shield-halved'}`}></i>
                  </span>
                  <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                    {pendingReport.reportingText}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    type="button"
                    onClick={handleUndoReport}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      borderRadius: '999px',
                      border: 'none',
                      background: '#e0f2fe',
                      color: '#0f172a',
                      fontSize: '0.95rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={handleDoneReport}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      borderRadius: '999px',
                      border: 'none',
                      background: '#115e59',
                      color: '#ffffff',
                      fontSize: '0.95rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shared LankaStay Footer */}
      <footer className="app-footer" style={{ marginBottom: 0, paddingBottom: '20px' }}>
        <div className="fotter-brand-section">
          <div className="footer-logo">
            <i className="fa-solid fa-umbrella-beach logo-icon-gold"></i>
            <div className="logo-text">
              <h2>LANKA STAY</h2>
              <small>YOUR JOURNEY, OUR CARE</small>
            </div>
          </div>
          <p className="footer-about-text">
            <strong>LANKA Stay</strong>
            <span data-i18n="fd1">
              {' '}
              - operated by LankaGo (Pvt) Ltd and incorporated under companies Act No. 7 0f 2026 (company Registration no. PV00345889) - is your trusted Sri Lanka travel partner, dedicated to crafting tailor-made journeys, authentic experiences, cultural immersion, and exceptional comfort.
            </span>
          </p>

          <p className="footer-about-text">
            <span data-i18n="fd2">
              We bring your travel dreams to life through expertly curated itineraries, genuine local insights, and personalized service every step of the way - <em>Because your journey our care.</em>
            </span>
          </p>

          <div className="footer-social-icons">
            <a href="#"><i className="fa-brands fa-linkedin-in"></i></a>
            <a href="#"><i className="fa-brands fa-facebook-f"></i></a>
            <a href="#"><i className="fa-brands fa-instagram"></i></a>
            <a href="#"><i className="fa-brands fa-youtube"></i></a>
            <a href="#"><i className="fa-brands fa-pinterest-p"></i></a>
            <a href="#"><i className="fa-brands fa-x-twitter"></i></a>
            <a href="#"><i className="fa-brands fa-tiktok"></i></a>
          </div>

          <div className="footer-partner-badge">
            <span className="badge-tag">PARTNERED ON SOCIAL MEDIA</span>
            <div className="partner-box-content">
              <div className="partner-logo-title">Pick Me</div>
              <div className="partner-sub">Official Travel Media Partner</div>
            </div>
          </div>
        </div>

        <hr className="footer-divider" />

        <div className="footer-block">
          <h3 className="footer-heading">
            <span data-i18n="lh">QUICK LINKS</span>
          </h3>
          <ul className="footer-nav-list">
            <li><a href={`${BASE}`}><span data-i18n="l1">Home</span></a></li>
            <li><a href="#"><span data-i18n="l2">Travel Testimonials</span></a></li>
            <li><a href="#"><span data-i18n="l3">Tour Package</span></a></li>
            <li><a href="#"><span data-i18n="l4">Day Tours</span></a></li>
            <li><a href={`${BASE}explore`}><span data-i18n="l5">Destinations</span></a></li>
            <li><a href="#"><span data-i18n="l6">Tailor Made Tours</span></a></li>
            <li><a href="#"><span data-i18n="l7">MICE &amp; Corporate Travel</span></a></li>
            <li><a href="#"><span data-i18n="l8">Blog</span></a></li>
            <li><a href="#"><span data-i18n="l9">Careers</span></a></li>
            <li><a href="#"><span data-i18n="l10">Our Partners</span></a></li>
            <li><a href="#"><span data-i18n="l11">pay-fee-PVT-Ltd</span></a></li>
            <li><a href="#"><span data-i18n="l12">Faq</span></a></li>
            <li><a href="#"><span data-i18n="l13">About Us</span></a></li>
            <li><a href="#"><span data-i18n="l14">Contact Us</span></a></li>
            <li><a href="#"><span data-i18n="l15">Rate Us</span></a></li>
          </ul>
        </div>

        <hr className="footer-divider" />

        <div className="footer-block">
          <h3 className="footer-heading">
            <span data-i18n="destinations">DESTINATIONS</span>
          </h3>
          <ul className="footer-nav-list">
            <li><a href="#"><span data-i18n="sigiriya">Sigiriya</span></a></li>
            <li><a href="#"><span data-i18n="kandy">Kandy</span></a></li>
            <li><a href="#"><span data-i18n="ella">Ella</span></a></li>
            <li><a href="#"><span data-i18n="nuwara_eliya">Nuwara Eliya</span></a></li>
            <li><a href="#"><span data-i18n="mirissa">Mirissa</span></a></li>
            <li><a href="#"><span data-i18n="galle">Galle</span></a></li>
            <li><a href="#"><span data-i18n="yala_national_park">Yala National Park</span></a></li>
            <li><a href="#"><span data-i18n="colombo">Colombo</span></a></li>
            <li><a href="#"><span data-i18n="arugam_bay">Arugam Bay</span></a></li>
          </ul>
        </div>

        <div className="footer-block">
          <h3 className="footer-heading">BROWSE SRI LANKA TOURS</h3>
          <div className="footer-tags-wrapper">
            <a href="#" className="tour-chip">Wildlife Safaris</a>
            <a href="#" className="tour-chip">Honeymoon Packages</a>
            <a href="#" className="tour-chip">Luxury Packages</a>
            <a href="#" className="tour-chip">Family Trips</a>
            <a href="#" className="tour-chip">Ayurveda &amp; Wellness</a>
            <a href="#" className="tour-chip">Cultural Tours</a>
            <a href="#" className="tour-chip">Heritage &amp; History</a>
            <a href="#" className="tour-chip">Beach holidays</a>
            <a href="#" className="tour-chip">Adventure Tours</a>
            <a href="#" className="tour-chip">Nature &amp; Hills</a>
            <a href="#" className="tour-chip">Private Transfers</a>
            <a href="#" className="tour-chip">Scenic Train Journeys</a>
            <a href="#" className="tour-chip">7 Days in Sri Lanka</a>
            <a href="#" className="tour-chip">10 Days in Sri Lanka</a>
            <a href="#" className="tour-chip">12 Days in Sri Lanka</a>
            <a href="#" className="tour-chip">14 Days in Sri Lanka</a>
          </div>
        </div>

        <hr className="footer-divider" />

        <div className="footer-block">
          <h3 className="footer-heading">OUR OFFICE</h3>
          <ul className="footer-contact-list">
            <li>
              <i className="fa-solid fa-phone"></i>
              <span>Hotline: +94 85 345 3454</span>
            </li>
            <li>
              <i className="fa-solid fa-phone-volume"></i>
              <span>General: +94 11 478 6784</span>
            </li>
            <li>
              <i className="fa-solid fa-whatsapp"></i>
              <span>Chat On WhatsApp</span>
            </li>
            <li>
              <i className="fa-solid fa-envelope"></i>
              <span>info@lankastay.com</span>
            </li>
            <li>
              <i className="fa-solid fa-location-dot"></i>
              <span>Lanka Stay (Pvt) Ltd, No. 105/A1, Western Province, Colombo3, Sri Lanka</span>
            </li>
          </ul>
        </div>

        <div className="footer-newsletter-card">
          <h3 className="newsletter-sub">Subscribe to receive travel tips and exclusive offers.</h3>
          <form className="newsletter-form" onSubmit={handleSubscribeSubmit}>
            <input
              type="text"
              placeholder="Your Name"
              value={subscriberName}
              onChange={(e) => setSubscriberName(e.target.value)}
              required
            />
            <input
              type="email"
              placeholder="Your Email"
              value={subscriberEmail}
              onChange={(e) => setSubscriberEmail(e.target.value)}
              required
            />
            <button type="submit" disabled={subscribing}>
              {subscribing ? 'Subscribing...' : 'Subscribe Now'}
            </button>
          </form>
        </div>

        <div className="footer-legal">
          <p>&copy; 2026 <strong>Lanka Stay (Pvt) Ltd</strong>. All rights reserved.</p>
          <div className="footer-legal-links">
            <a href="#">Privacy Policy</a> &bull;
            <a href="#">Terms and Conditions</a> &bull;
            <a href="#">Cookie Policy</a> &bull;
            <a href="#">Sitemap</a>
          </div>
        </div>
      </footer>
    </main>
  );
}