import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../SupabaseClient';
import { assetUrl } from '../utils/assetUrl';

const hotelsData = [
  {
    id: 101,
    name: "Water Garden Sigiriya",
    region: "Cultural",
    price: 28000,
    score: 94,
    images: [
      assetUrl("/images/water-garden-sigiriya.jpg"),
      assetUrl("https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800"),
      assetUrl("https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800"),
      assetUrl("https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800")
    ],
    plainEnglish: "Near Sigiriya Rock, Optimal Dry Season.",
    description: "Experience luxury amidst ancient history. Water Garden Sigiriya offers private villas, stunning views of the Sigiriya rock fortress, and world-class hospitality."
  },
  {
    id: 102,
    name: "Uga Bay Pasikuda",
    region: "East Coast",
    price: 32000,
    score: 89,
    images: [
      assetUrl("/images/ugabaypasikuda.webp"),
      assetUrl("https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800"),
      assetUrl("https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800"),
      assetUrl("https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800")
    ],
    plainEnglish: "East coast calm waters, perfect weather.",
    description: "A tropical beach sanctuary on the sun-drenched east coast. Enjoy golden sandy beaches, crystal-clear shallow waters, and luxury beachfront suites."
  },
  {
    id: 103,
    name: "Avani Bentota Resort",
    region: "South Coast",
    price: 22000,
    score: 62,
    images: [
      assetUrl("/images/avanib.webp"),
      assetUrl("https://images.unsplash.com/photo-1584132967334-10e028bd69f7?w=800"),
      assetUrl("https://images.unsplash.com/photo-1591088398332-8a7791972843?w=800"),
      assetUrl("https://images.unsplash.com/photo-1561501900-3701fa6a0864?w=800")
    ],
    plainEnglish: "South-West monsoon down-ranking applied.",
    description: "Designed by renowned architect Geoffrey Bawa, Avani Bentota blends Dutch colonial charm with modern beachfront luxury."
  },
  {
    id: 104,
    name: "Argyle Luxury Hatton",
    region: "Hill Country",
    price: 18500,
    score: 88,
    images: [
      assetUrl("https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800"),
      assetUrl("https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?w=800"),
      assetUrl("https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=800"),
      assetUrl("https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800")
    ],
    plainEnglish: "Cool tea plantation views, 30 min road access.",
    description: "Nestled in the misty hills of Hatton, Argyle Luxury offers panoramic tea garden views, crisp mountain air, and cozy fireplaces."
  }
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const SW_MONSOON_MONTHS = new Set(["May", "June", "July", "August", "September"]);
const NE_MONSOON_MONTHS = new Set(["November", "December", "January", "February"]);

function computeLocalMonsoonScore(hotel, month) {
  const baseScore = hotel.score ?? 80;
  const region = hotel.region || "Cultural";
  let delta = 0;
  let monsoonNote = hotel.plainEnglish;

  if (region === "South Coast") {
    if (SW_MONSOON_MONTHS.has(month)) {
      delta = -32;
      monsoonNote = `South-West monsoon active in ${month} — rough seas & rain on South Coast.`;
    } else if (NE_MONSOON_MONTHS.has(month)) {
      delta = 14;
      monsoonNote = `Dry & sunny South Coast conditions expected in ${month}.`;
    } else {
      delta = 8;
      monsoonNote = `Inter-monsoon transition in ${month} — generally warm along South Coast.`;
    }
  } else if (region === "East Coast") {
    if (NE_MONSOON_MONTHS.has(month)) {
      delta = -30;
      monsoonNote = `North-East monsoon active in ${month} — rain & choppier East Coast waters.`;
    } else if (SW_MONSOON_MONTHS.has(month)) {
      delta = 10;
      monsoonNote = `Peak East Coast dry & calm beach season in ${month}.`;
    } else {
      delta = 6;
      monsoonNote = `Pleasant East Coast conditions during ${month}.`;
    }
  } else if (region === "Hill Country") {
    if (SW_MONSOON_MONTHS.has(month)) {
      delta = -14;
      monsoonNote = `Hill Country misty & wetter during ${month} South-West monsoon.`;
    } else if (month === "January" || month === "February" || month === "March") {
      delta = 8;
      monsoonNote = `Crisp, clearer highland weather in ${month}.`;
    } else {
      delta = 2;
      monsoonNote = hotel.plainEnglish;
    }
  } else {
    // Cultural Triangle
    if (NE_MONSOON_MONTHS.has(month) && (month === "November" || month === "December")) {
      delta = -8;
      monsoonNote = `Occasional showers possible in Cultural Triangle in ${month}.`;
    } else {
      delta = 4;
      monsoonNote = `Warm, favorable Cultural Triangle weather in ${month}.`;
    }
  }

  const tripFitScore = Math.max(25, Math.min(99, baseScore + delta));
  return {
    tripFitScore,
    monsoonNote,
    monsoonWarning: delta <= -20 ? monsoonNote : null
  };
}

const countryCodes = [
  { name: "Sri Lanka", code: "+94", flag: "🇱🇰" },
  { name: "United States", code: "+1", flag: "🇺🇸" },
  { name: "United Kingdom", code: "+44", flag: "🇬🇧" },
  { name: "Australia", code: "+61", flag: "🇦🇺" },
  { name: "India", code: "+91", flag: "🇮🇳" },
  { name: "Germany", code: "+49", flag: "🇩🇪" },
  { name: "France", code: "+33", flag: "🇫🇷" },
  { name: "Canada", code: "+1", flag: "🇨🇦" }
];

export default function HotelDetail() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const hotelId = parseInt(searchParams.get('id') || '101', 10);
  const hotel = useMemo(
    () => hotelsData.find((h) => h.id === hotelId) || hotelsData[0],
    [hotelId]
  );

  const initialMonth = MONTHS.includes(searchParams.get('month'))
    ? searchParams.get('month')
    : MONTHS[new Date().getMonth()];

  const [travelMonth, setTravelMonth] = useState(initialMonth);
  const [rankingMeta, setRankingMeta] = useState(() =>
    computeLocalMonsoonScore(hotel, initialMonth)
  );
  const [rankingSource, setRankingSource] = useState('local');
  const [activeImage, setActiveImage] = useState(hotel.images[0]);

  // Newsletter states
  const [subscriberName, setSubscriberName] = useState('');
  const [subscriberEmail, setSubscriberEmail] = useState('');
  const [subscribing, setSubscribing] = useState(false);

  const discountRate = 0.20;
  const discountedRate = hotel.price * (1 - discountRate);

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    countryCode: '+94',
    phoneNum: '',
    checkIn: '',
    checkOut: '',
    guests: '2'
  });

  useEffect(() => {
    setActiveImage(hotel.images[0]);
  }, [hotel]);

  useEffect(() => {
    const queryMonth = searchParams.get('month');
    if (queryMonth && MONTHS.includes(queryMonth) && queryMonth !== travelMonth) {
      setTravelMonth(queryMonth);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    const fallback = computeLocalMonsoonScore(hotel, travelMonth);
    setRankingMeta(fallback);

    const apiBase = import.meta.env.VITE_MONSOON_API_URL;
    if (!apiBase) {
      setRankingSource('local');
      return () => {
        cancelled = true;
      };
    }

    const controller = new AbortController();
    fetch(`${apiBase.replace(/\/$/, '')}/api/hotels/rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month: travelMonth,
        hotels: [
          {
            id: hotel.id,
            name: hotel.name,
            region: hotel.region,
            base_score: hotel.score,
            plain_english: hotel.plainEnglish
          }
        ]
      }),
      signal: controller.signal
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (cancelled) return;
        const rankedItem = Array.isArray(data)
          ? data.find((item) => item.id === hotel.id) || data[0]
          : Array.isArray(data?.hotels)
          ? data.hotels.find((item) => item.id === hotel.id) || data.hotels[0]
          : null;

        if (rankedItem) {
          setRankingMeta({
            tripFitScore:
              rankedItem.trip_fit_score ?? rankedItem.score ?? fallback.tripFitScore,
            monsoonNote:
              rankedItem.reason ||
              rankedItem.plain_english ||
              rankedItem.monsoon_note ||
              fallback.monsoonNote,
            monsoonWarning: rankedItem.monsoon_warning ?? fallback.monsoonWarning
          });
          setRankingSource('api');
        } else {
          setRankingSource('local');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRankingMeta(fallback);
          setRankingSource('local');
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [hotel, travelMonth]);

  const handleMonthChange = (e) => {
    const nextMonth = e.target.value;
    setTravelMonth(nextMonth);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('month', nextMonth);
    setSearchParams(nextParams, { replace: true });
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleBookingSubmit = async (e) => {
    e.preventDefault();
    if (!formData.fullName || !formData.email || !formData.phoneNum || !formData.checkIn || !formData.checkOut) {
      alert('Please fill in all required fields.');
      return;
    }

    const fullPhoneNumber = `${formData.countryCode} ${formData.phoneNum}`;

    try {
      const { error } = await supabase
        .from('hotel_bookings')
        .insert([
          {
            hotel_id: hotel.id,
            hotel_name: hotel.name,
            full_name: formData.fullName,
            email: formData.email,
            phone: fullPhoneNumber,
            check_in: formData.checkIn,
            check_out: formData.checkOut,
            guests: parseInt(formData.guests, 10),
            total_price: discountedRate
          }
        ]);

      if (error) throw error;
      alert('Booking confirmed successfully and saved to records!');
      setFormData({
        fullName: '',
        email: '',
        countryCode: '+94',
        phoneNum: '',
        checkIn: '',
        checkOut: '',
        guests: '2'
      });
    } catch (err) {
      console.error('Booking error:', err.message);
      alert('Failed to complete booking. Please check database permissions.');
    }
  };

  // Supabase Database Handler & Safe EmailJS Confirmation for Newsletter Subscription
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
        if (error.code === '23505') {
          alert('This email address is already subscribed to Lanka Stay!');
        } else {
          alert('Subscription failed: ' + error.message);
        }
      } else {
        try {
          await emailjs.send(
            'YOUR_SERVICE_ID',
            'YOUR_TEMPLATE_ID',
            {
              to_name: subscriberName.trim(),
              to_email: subscriberEmail.trim(),
              message: 'Thank you for subscribing to Lanka Stay! You will now receive exclusive travel tips, destination updates, and special offers. Your journey, our care.'
            },
            'YOUR_PUBLIC_KEY'
          );
          alert('Successfully subscribed and confirmation email sent!');
        } catch (emailErr) {
          console.warn('EmailJS note: Configure your service ID, template ID, and public key to enable automatic emails.', emailErr);
          alert('Successfully subscribed to Lanka Stay!');
        }

        setSubscriberName('');
        setSubscriberEmail('');
      }
    } catch (err) {
      alert('An unexpected error occurred: ' + (err?.message || err));
    } finally {
      setSubscribing(false);
    }
  };

  const badgeColor =
    rankingMeta.tripFitScore >= 80
      ? '#1d6b4f'
      : rankingMeta.tripFitScore >= 65
      ? '#b45309'
      : '#b91c1c';

  return (
    <main className="screen">
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <Link to={`/hotels?month=${encodeURIComponent(travelMonth)}`}><i className="fa-solid fa-arrow-left"></i></Link>
          <h2>Hotel Details &amp; Booking</h2>
        </div>
        <Link to="/saved" title="Saved Places" style={{ color: 'inherit', fontSize: '1.2rem' }}>
          <i className="fa-solid fa-bookmark"></i>
        </Link>
      </header>

      <section style={{ padding: '16px' }}>
        <div style={{ borderRadius: '0px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', background: '#fff' }}>

          {/* Large Main Photo */}
          <div style={{ position: 'relative', height: '260px', width: '100%' }}>
            <img src={activeImage} alt={hotel.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '0px' }} />
            <span
              style={{
                position: 'absolute',
                top: '12px',
                left: '12px',
                background: badgeColor,
                color: '#fff',
                padding: '6px 12px',
                borderRadius: '0px',
                fontSize: '12px',
                fontWeight: 'bold'
              }}
            >
              Fit Score ({travelMonth}): {rankingMeta.tripFitScore}/100
            </span>
          </div>

          {/* 3-4 Small Thumbnail Gallery */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', padding: '10px', background: '#f1f3f5' }}>
            {hotel.images.map((imgUrl, idx) => (
              <img
                key={idx}
                src={imgUrl}
                alt={`Thumb ${idx}`}
                onClick={() => setActiveImage(imgUrl)}
                style={{
                  height: '60px',
                  width: '100%',
                  objectFit: 'cover',
                  cursor: 'pointer',
                  borderRadius: '0px',
                  border: activeImage === imgUrl ? '3px solid #1d6b4f' : '1px solid #ddd'
                }}
              />
            ))}
          </div>

          <div style={{ padding: '20px' }}>
            {/* Travel Month Selector for Live Trip Fit Score */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                background: '#ffffff',
                padding: '10px 12px',
                border: '1px solid #ffffff',
                marginBottom: '14px'
              }}
            >
              <label htmlFor="detail-travel-month" style={{ fontSize: '13px', fontWeight: '600', color: '#1f2937' }}>
                <i className="fa-solid fa-cloud-sun-rain" style={{ marginRight: '6px', color: '#1d6b4f' }}></i>
                Travel Month ({hotel.region})
              </label>
              <select
                id="detail-travel-month"
                value={travelMonth}
                onChange={handleMonthChange}
                style={{
                  padding: '6px 10px',
                  borderRadius: '8px',
                  border: '1px solid #1d6b4f',
                  fontSize: '13px',
                  color: '#ffffff',
                  background: '#1d6b4f',
                  fontWeight: '600'
                }}
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <h1 style={{ margin: '0 0 8px 0', fontSize: '22px', fontWeight: '700' }}>{hotel.name}</h1>
            <p style={{ margin: '0 0 12px 0', color: '#555', fontSize: '14px' }}>{hotel.description}</p>
            <p style={{ margin: '0 0 12px 0', color: '#1d6b4f', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-circle-info"></i> {rankingMeta.monsoonNote}{' '}
              <span style={{ color: '#6b7280', fontWeight: '400' }}>
                ({rankingSource === 'api' ? 'Monsoon Engine API' : 'Seasonal Engine'})
              </span>
            </p>

            {rankingMeta.monsoonWarning && (
              <div
                style={{
                  background: '#fef2f2',
                  borderLeft: '4px solid #b91c1c',
                  color: '#991b1b',
                  padding: '10px 12px',
                  fontSize: '13px',
                  fontWeight: '600',
                  marginBottom: '16px'
                }}
              >
                <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: '6px' }}></i>
                {rankingMeta.monsoonWarning}
              </div>
            )}

            {/* Rates Section */}
            <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '0px', borderLeft: '4px solid #1d6b4f', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>Special Rates</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ textDecoration: 'line-through', color: '#888', fontSize: '14px' }}>
                  LKR {hotel.price.toLocaleString()}
                </span>
                <b style={{ color: '#1d6b4f', fontSize: '18px' }}>
                  LKR {discountedRate.toLocaleString()} <span style={{ fontSize: '12px', fontWeight: 'normal' }}>/ night</span>
                </b>
                <span style={{ background: '#e2f6ed', color: '#1d6b4f', padding: '2px 8px', borderRadius: '0px', fontSize: '12px', fontWeight: 'bold' }}>
                  20% OFF Applied
                </span>
              </div>
            </div>

            {/* Navigation Button Back to Hotels */}
            <div style={{ marginBottom: '20px' }}>
              <button
                type="button"
                onClick={() => navigate(`/hotels?month=${encodeURIComponent(travelMonth)}`)}
                style={{
                  background: '#f44336',
                  color: 'white',
                  border: '1px solid #f44336',
                  padding: '10px 16px',
                  borderRadius: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <i className="fa-solid fa-arrow-left"></i> Browse Other Hotels
              </button>
            </div>

            {/* Always Visible Guest Detail Form / Booking Filler */}
            <form onSubmit={handleBookingSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', borderBottom: '2px solid #eee', paddingBottom: '8px' }}>
                Guest Details &amp; Checkout
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600' }}>Full Name</label>
                <input
                  type="text"
                  name="fullName"
                  placeholder="Enter your full name"
                  value={formData.fullName}
                  onChange={handleChange}
                  required
                  style={{ padding: '10px', borderRadius: '12px', border: '1px solid #ccc', fontSize: '14px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600' }}>Email Address</label>
                <input
                  type="email"
                  name="email"
                  placeholder="name@example.com"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  style={{ padding: '10px', borderRadius: '12px', border: '1px solid #ccc', fontSize: '14px' }}
                />
              </div>

              {/* Country Flag & Phone Number Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600' }}>Phone Number</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    name="countryCode"
                    value={formData.countryCode}
                    onChange={handleChange}
                    style={{ padding: '10px', borderRadius: '12px', border: '1px solid #ccc', fontSize: '14px', background: '#fff', width: '120px' }}
                  >
                    {countryCodes.map((c, idx) => (
                      <option key={idx} value={c.code}>
                        {c.flag} {c.code}
                      </option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    name="phoneNum"
                    placeholder="7X XXX XXXX"
                    value={formData.phoneNum}
                    onChange={handleChange}
                    required
                    style={{ flex: 1, padding: '10px', borderRadius: '12px', border: '1px solid #ccc', fontSize: '14px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600' }}>Check-in Date</label>
                  <input
                    type="date"
                    name="checkIn"
                    value={formData.checkIn}
                    onChange={handleChange}
                    required
                    style={{ padding: '10px', borderRadius: '12px', border: '1px solid #ccc', fontSize: '14px' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600' }}>Check-out Date</label>
                  <input
                    type="date"
                    name="checkOut"
                    value={formData.checkOut}
                    onChange={handleChange}
                    required
                    style={{ padding: '10px', borderRadius: '12px', border: '1px solid #ccc', fontSize: '14px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600' }}>Guests</label>
                <select
                  name="guests"
                  value={formData.guests}
                  onChange={handleChange}
                  style={{ padding: '10px', borderRadius: '12px', border: '1px solid #ccc', fontSize: '14px', background: '#fff' }}
                >
                  <option value="1">1 Guest</option>
                  <option value="2">2 Guests</option>
                  <option value="3">3 Guests</option>
                  <option value="4">4+ Guests</option>
                </select>
              </div>

              <button
                type="submit"
                style={{
                  background: '#09412c',
                  color: '#fff',
                  border: 'none',
                  padding: '14px',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  marginTop: '10px'
                }}
              >
                Confirm &amp; Book Now
              </button>
            </form>

          </div>
        </div>
      </section>

      {/* Footer */}
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
            <strong>LANKA Stay</strong><span data-i18n="fd1"> - operated by LankaGo (Pvt) Ltd and incorporated under companies Act No. 7 0f 2026 (company Registration no. PV00345889) - is your trusted Sri Lanka travel partner, dedicated to crafting tailor-made journeys, authentic experiences, cultural immersion, and exceptional comfort.</span>
          </p>

          <p className="footer-about-text"><span data-i18n="fd2">
            We bring your travel dreams to life through expertly curated itineraries, genuine local insights, and personalized service every step of the way - <em>Because your journey our care.</em>
          </span></p>

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
          <h3 className="footer-heading"><span data-i18n="lh">QUICK LINKS</span></h3>
          <ul className="footer-nav-list">
            <li><a href="#"><span data-i18n="l1">Home</span></a></li>
            <li><a href="#"><span data-i18n="l2">Travel Testimonials</span></a></li>
            <li><a href="#"><span data-i18n="l3">Tour Package</span></a></li>
            <li><a href="#"><span data-i18n="l4">Day Tours</span></a></li>
            <li><a href="#"><span data-i18n="l5">Destinations</span></a></li>
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
          <h3 className="footer-heading"><span data-i18n="destinations">DESTINATIONS</span></h3>
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