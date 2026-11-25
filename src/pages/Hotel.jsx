import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../SupabaseClient';
import { assetUrl } from '../utils/assetUrl';

const BASE = import.meta.env.BASE_URL;
const API_BASE = import.meta.env.VITE_MONSOON_API_URL || 'http://localhost:8000';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const hotelsData = [
  {
    id: 101,
    name: "Water Garden Sigiriya",
    region: "Cultural",
    price: 28000,
    score: 94,
    rating: 4.7,
    img: `${BASE}images/water-garden-sigiriya.jpg`,
    plainEnglish: "Near Sigiriya Rock, Optimal Dry Season.",
    description: "Experience luxury amidst ancient history. Water Garden Sigiriya offers private villas, stunning views of the Sigiriya rock fortress, and world-class hospitality."
  },
  {
    id: 102,
    name: "Uga Bay Pasikuda",
    region: "East Coast",
    price: 32000,
    score: 89,
    rating: 4.7,
    img: `${BASE}images/ugabaypasikuda.webp`,
    plainEnglish: "East coast calm waters, perfect weather.",
    description: "A tropical beach sanctuary on the sun-drenched east coast. Enjoy golden sandy beaches, crystal-clear shallow waters, and luxury beachfront suites."
  },
  {
    id: 103,
    name: "Avani Bentota Resort",
    region: "South Coast",
    price: 22000,
    score: 62,
    rating: 4.7,
    img: `${BASE}images/avanib.webp`,
    plainEnglish: "South-West monsoon down-ranking applied.",
    description: "Designed by renowned architect Geoffrey Bawa, Avani Bentota blends Dutch colonial charm with modern beachfront luxury."
  },
  {
    id: 104,
    name: "Argyle Luxury Hatton",
    region: "Hill Country",
    price: 18500,
    score: 88,
    rating: 4.7,
    img: assetUrl("https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=400"),
    plainEnglish: "Cool tea plantation views, 30 min road access.",
    description: "Nestled in the misty hills of Hatton, Argyle Luxury offers panoramic tea garden views, crisp mountain air, and cozy fireplaces."
  }
];

function fallbackMonsoonRank(list, month) {
  const mapped = list.map((h) => {
    const reg = (h.region || '').toLowerCase();
    let monsoonActive = false;
    let score = h.score || 85;
    let seasonLabel = 'Dry / Favorable';
    let plainEnglish = h.plainEnglish;

    if ([5, 6, 7, 8, 9].includes(month)) {
      if (reg.includes('south')) {
        monsoonActive = true;
        score = 52;
        seasonLabel = 'Southwest Monsoon Active';
        plainEnglish = 'Down-ranked: Southwest monsoon rains in South Coast.';
      } else if (reg.includes('hill')) {
        monsoonActive = true;
        score = 65;
        seasonLabel = 'Southwest Showers';
        plainEnglish = 'Adjusted: Hill country showers during Southwest monsoon.';
      } else {
        monsoonActive = false;
        score = reg.includes('east') ? 96 : 92;
        seasonLabel = 'No Monsoon (Dry)';
        plainEnglish = 'Top fit: No active monsoon in this region.';
      }
    } else if ([11, 12, 1, 2].includes(month)) {
      if (reg.includes('east')) {
        monsoonActive = true;
        score = 54;
        seasonLabel = 'Northeast Monsoon Active';
        plainEnglish = 'Down-ranked: Northeast monsoon active on East Coast.';
      } else {
        monsoonActive = false;
        score = reg.includes('south') ? 97 : 94;
        seasonLabel = 'No Monsoon (Clear)';
        plainEnglish = 'Top fit: Dry, sunny conditions with no monsoon.';
      }
    }

    return {
      ...h,
      score,
      monsoon_active: monsoonActive,
      season_label: seasonLabel,
      plainEnglish
    };
  });

  return mapped.sort((a, b) => {
    if (a.monsoon_active !== b.monsoon_active) {
      return a.monsoon_active ? 1 : -1;
    }
    return b.score - a.score;
  });
}

export default function Hotel() {
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [rankedHotels, setRankedHotels] = useState(() => fallbackMonsoonRank(hotelsData, new Date().getMonth() + 1));
  const [monsoonBanner, setMonsoonBanner] = useState(
    'Northeast Monsoon Active (Nov–Feb): East/North coast hotels are down-ranked while dry regions lead.'
  );
  const [loadingRank, setLoadingRank] = useState(false);
  const [apiConnected, setApiConnected] = useState(false);

  const [currentRegion, setCurrentRegion] = useState('all');
  const [savedItems, setSavedItems] = useState({});
  const [userId, setUserId] = useState(null);
  const [subscriberName, setSubscriberName] = useState('');
  const [subscriberEmail, setSubscriberEmail] = useState('');
  const [subscribing, setSubscribing] = useState(false);
  const navigate = useNavigate();
  const discountRate = 0.20;

  useEffect(() => {
    fetchSavedItems();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchSavedItems();
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;

    async function fetchMonsoonRanking() {
      setLoadingRank(true);
      try {
        const res = await fetch(`${API_BASE}/api/hotels/rank`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            month: selectedMonth,
            hotels: hotelsData
          })
        });

        if (!res.ok) throw new Error(`API status ${res.status}`);
        const data = await res.json();

        if (active && Array.isArray(data.hotels)) {
          setRankedHotels(data.hotels);
          if (data.monsoon_banner) setMonsoonBanner(data.monsoon_banner);
          setApiConnected(true);
        }
      } catch (err) {
        console.warn('Monsoon API fallback active:', err.message);
        if (active) {
          setRankedHotels(fallbackMonsoonRank(hotelsData, selectedMonth));
          setApiConnected(false);
        }
      } finally {
        if (active) setLoadingRank(false);
      }
    }

    fetchMonsoonRanking();
    return () => {
      active = false;
    };
  }, [selectedMonth]);

  const fetchSavedItems = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setUserId(null);
        setSavedItems({});
        return;
      }

      setUserId(user.id);
      const { data, error } = await supabase
        .from('saved_destinations')
        .select('destination_id')
        .eq('user_id', user.id);

      if (error) throw error;

      const savedMap = {};
      (data || []).forEach(item => { savedMap[item.destination_id] = true; });
      setSavedItems(savedMap);
    } catch (err) {
      console.error('Error fetching saved items:', err.message);
    }
  };

  const filteredHotels = currentRegion === 'all'
    ? rankedHotels
    : rankedHotels.filter(h => h.region.toLowerCase() === currentRegion.toLowerCase());

  const toggleHeart = async (hotel, e) => {
    e.stopPropagation();

    const { data: { user } } = await supabase.auth.getUser();
    const activeUserId = user?.id || userId;
    if (!activeUserId) {
      alert('Please sign in on your Profile page first to save hotels.');
      return;
    }

    const isCurrentlySaved = !!savedItems[hotel.id];
    setSavedItems(prev => ({ ...prev, [hotel.id]: !isCurrentlySaved }));

    try {
      if (isCurrentlySaved) {
        const { error } = await supabase
          .from('saved_destinations')
          .delete()
          .match({ destination_id: hotel.id, user_id: activeUserId });

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('saved_destinations')
          .insert([{
            user_id: activeUserId,
            destination_id: hotel.id,
            name: hotel.name,
            category: hotel.region,
            rating: String(hotel.rating || "4.7"),
            desc: hotel.plainEnglish,
            img: hotel.img,
            link: `/hotel-detail?id=${hotel.id}`
          }]);

        if (error) throw error;
      }
    } catch (err) {
      console.error('Error updating saved state:', err.message);
      setSavedItems(prev => ({ ...prev, [hotel.id]: isCurrentlySaved }));
      alert('Failed to update saved status. Please check Supabase RLS policies.');
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

  return (
    <main className="screen">
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <Link to="/"><i className="fa-solid fa-arrow-left"></i></Link>
          <h2 data-i18n="hotels">Hotels in Sri Lanka</h2>
        </div>
        <Link to="/saved" title="View Saved Places" style={{ color: 'inherit', fontSize: '1.2rem' }}>
          <i className="fa-solid fa-bookmark"></i>
        </Link>
      </header>

      <div style={{ padding: '0 16px' }}>
        <div className="monsoon-warning">
          <i className="fa-solid fa-cloud-showers-heavy"></i>
          <span data-i18n="monsoon_warning">
            <b>Monsoon Engine ({MONTHS[selectedMonth - 1]}):</b> {monsoonBanner}{' '}
            <small style={{ opacity: 0.85 }}>
              {loadingRank ? '(Updating...)' : apiConnected ? '(Live API)' : '(Local Preview)'}
            </small>
          </span>
        </div>

        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <label htmlFor="monsoonMonthSelect" style={{ fontSize: '13px', fontWeight: '600' }}>
            Travel Month:
          </label>
          <select
            id="monsoonMonthSelect"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            style={{
              padding: '6px 10px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              background: '#fff',
              color: '#111'
            }}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      <br />

      <div className="chips" id="hotelFilterChips">
        {['all', 'Cultural', 'East Coast', 'South Coast', 'Hill Country'].map((reg) => (
          <button
            key={reg}
            className={`chip ${currentRegion === reg.toLowerCase() || (reg === 'all' && currentRegion === 'all') ? 'active' : ''}`}
            onClick={() => setCurrentRegion(reg.toLowerCase())}
            style={{ borderRadius: '20px' }}
          >
            {reg.charAt(0).toUpperCase() + reg.slice(1)}
          </button>
        ))}
      </div>
      <br />

      <section className="list" id="hotelList">
        {filteredHotels.length === 0 ? (
          <p className="empty">No hotels found for this region.</p>
        ) : (
          filteredHotels.map((h, index) => {
            const discountedPrice = h.price * (1 - discountRate);
            const isTopPick = !h.monsoon_active && index === 0;

            return (
              <article
                key={h.id}
                className="loc-hotel-card"
                onClick={() => navigate(`/hotel-detail?id=${h.id}`)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  marginBottom: '16px',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  background: '#fff',
                  cursor: 'pointer',
                  position: 'relative',
                  opacity: h.monsoon_active ? 0.88 : 1
                }}
              >
                <div style={{ position: 'relative', height: '160px', width: '100%' }}>
                  <img src={h.img} alt={h.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '0px' }} />
                  <span className="trip-score-badge" style={{ position: 'absolute', top: '12px', left: '12px' }}>
                    {isTopPick ? '★ Top Fit: ' : 'Fit Score: '}{h.score}/100
                  </span>

                  <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      className={`heart ${savedItems[h.id] ? 'saved' : ''}`}
                      onClick={(e) => toggleHeart(h, e)}
                      style={{
                        background: 'rgba(0,0,0,0.5)',
                        border: 'none',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        display: 'grid',
                        placeItems: 'center',
                        cursor: 'pointer',
                        color: savedItems[h.id] ? '#ff4757' : '#fff'
                      }}
                    >
                      <i className={`${savedItems[h.id] ? 'fa-solid' : 'fa-regular'} fa-heart`}></i>
                    </button>
                    <span
                      className="rating"
                      style={{
                        background: 'rgba(0,0,0,0.7)',
                        color: '#fff',
                        padding: '4px 8px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <i className="fa-solid fa-star" style={{ color: '#ffc94d' }}></i> {h.rating || '4.7'}
                    </span>
                  </div>
                </div>

                <div style={{ padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>{h.name}</h3>
                      {h.season_label && (
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 7px',
                            borderRadius: '999px',
                            fontWeight: '600',
                            background: h.monsoon_active ? '#fee2e2' : '#dcfce7',
                            color: h.monsoon_active ? '#991b1b' : '#166534'
                          }}
                        >
                          {h.season_label}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '0 0 8px 0', fontSize: '12px', opacity: 0.8 }}>{h.plainEnglish}</p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ textDecoration: 'line-through', color: '#888', fontSize: '13px' }}>
                        LKR {h.price.toLocaleString()}
                      </span>
                      <b style={{ color: '#1d6b4f', fontSize: '15px' }}>
                        LKR {discountedPrice.toLocaleString()} / night
                      </b>
                      <span
                        style={{
                          background: '#e2f6ed',
                          color: '#1d6b4f',
                          padding: '2px 6px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 'bold'
                        }}
                      >
                        20% OFF
                      </span>
                    </div>
                  </div>
                  <button
                    className="arrow"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/hotel-detail?id=${h.id}`);
                    }}
                    title="View & Book"
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: '#1d6b4f',
                      color: 'white',
                      display: 'grid',
                      placeItems: 'center',
                      border: 'none',
                      flexShrink: 0,
                      cursor: 'pointer'
                    }}
                  >
                    <i className="fa-solid fa-check"></i>
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>

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