import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './components/Modal';
import content from './data/content';

const CHAT_STORAGE_KEY = 'chat_messages_v1';
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/mjgrlvel';
const CHAT_API_ENDPOINT = '/api/gemini_chat';

function formatRange(dateStr, timeStr, durationMin) {
  if (!dateStr || !timeStr) {
    return null;
  }

  const [yyyy, mm, dd] = dateStr.split('-').map(Number);
  const [hh, mn] = timeStr.split(':').map(Number);
  if ([yyyy, mm, dd, hh, mn].some((value) => Number.isNaN(value))) {
    return null;
  }

  const start = new Date(yyyy, mm - 1, dd, hh, mn);
  const end = new Date(start.getTime() + (parseInt(durationMin, 10) || 30) * 60000);
  const locale = navigator.language || 'en-US';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const opts = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const startText = start.toLocaleString(locale, opts);
  const endText = end.toLocaleString(locale, { hour: 'numeric', minute: '2-digit' });
  const utcText = `${start.toUTCString()} – ${end.toUTCString()}`;

  return { text: `${startText} – ${endText}`, tz, utcText };
}

function createICS({ name, email, date, time, duration, notes }) {
  const [yyyy, mm, dd] = date.split('-').map(Number);
  const [hh, mn] = time.split(':').map(Number);
  const start = new Date(yyyy, mm - 1, dd, hh, mn);
  const end = new Date(start.getTime() + (parseInt(duration, 10) || 30) * 60000);
  const fmt = (dateValue) => dateValue.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const uid = `schedule-${Date.now()}@example.com`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Schedule//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:Call with ${name || 'Guest'}`,
    `DESCRIPTION:Scheduled by: ${name || ''}\\nEmail: ${email || ''}${notes ? '\\n\\nNotes:\\n' + notes : ''}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `schedule-${yyyy}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function parseSseData(raw) {
  let accumulated = '';
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('data:')) {
      const payload = trimmed.replace(/^data:\s*/, '');
      if (payload === '[DONE]') {
        continue;
      }
      try {
        const parsed = JSON.parse(payload);
        if (parsed && parsed.chunk) {
          accumulated += parsed.chunk;
          continue;
        }
      } catch (error) {
        // ignore parse failures and use raw payload text
      }
      accumulated += payload;
    }
  }
  return accumulated;
}

function loadChatMessages() {
  try {
    if (typeof window === 'undefined') {
      return [];
    }
    return JSON.parse(window.localStorage.getItem(CHAT_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveChatMessages(messages) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') {
      return 'dark';
    }
    const saved = window.localStorage.getItem('theme');
    if (saved) {
      return saved;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [thirdPhotoVisible, setThirdPhotoVisible] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ name: '', email: '', date: '', time: '', duration: '30', notes: '' });
  const [scheduleStatus, setScheduleStatus] = useState({ text: '', kind: '' });
  const [scheduleSending, setScheduleSending] = useState(false);
  const [emailForm, setEmailForm] = useState({ name: '', from: '', subject: '', message: '' });
  const [emailErrors, setEmailErrors] = useState({});
  const [emailStatus, setEmailStatus] = useState({ text: '', kind: '' });
  const [emailSending, setEmailSending] = useState(false);
  const [chatMessages, setChatMessages] = useState(() => loadChatMessages());
  const [chatInput, setChatInput] = useState('');
  const [chatSearch, setChatSearch] = useState('');
  const [chatStatusText, setChatStatusText] = useState('');
  const [presenceOnline, setPresenceOnline] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);
  const galleryTrackRef = useRef(null);
  const scheduleFirstInput = useRef(null);
  const emailFirstInput = useRef(null);
  const chatInputRef = useRef(null);

  const profileImages = useMemo(
    () => ({
      primary: theme === 'dark' ? '/assets/profile1.png' : '/assets/profile1-lightmode.png',
      hover: theme === 'dark' ? '/assets/profile2png.png' : '/assets/profile2-lightmode.png',
      third: theme === 'dark' ? '/assets/profile3-darkmode.png' : '/assets/profile3-lightmode.png',
    }),
    [theme]
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (chatMessages.length === 0) {
      const greeting = {
        id: Date.now(),
        who: 'xiao',
        text: 'Hi — I\'m Xiao. How can I help?',
        ts: Date.now(),
        status: 'sent',
      };
      setChatMessages([greeting]);
      saveChatMessages([greeting]);
      return;
    }
    saveChatMessages(chatMessages);
  }, [chatMessages]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlide((value) => (value + 1) % content.recommendations.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const schedulePreview = useMemo(
    () => formatRange(scheduleForm.date, scheduleForm.time, scheduleForm.duration),
    [scheduleForm]
  );

  const filteredChatMessages = useMemo(() => {
    if (!chatSearch.trim()) {
      return chatMessages;
    }
    const term = chatSearch.toLowerCase();
    return chatMessages.filter((message) => message.text.toLowerCase().includes(term));
  }, [chatMessages, chatSearch]);

  const openScheduleModal = () => {
    setScheduleOpen(true);
    setTimeout(() => scheduleFirstInput.current?.focus(), 0);
  };

  const closeScheduleModal = () => {
    setScheduleOpen(false);
    setScheduleStatus({ text: '', kind: '' });
  };

  const openEmailModal = () => {
    setEmailOpen(true);
    setTimeout(() => emailFirstInput.current?.focus(), 0);
  };

  const closeEmailModal = () => {
    setEmailOpen(false);
    setEmailStatus({ text: '', kind: '' });
  };

  const openChatModal = () => {
    setChatOpen(true);
    setTimeout(() => chatInputRef.current?.focus(), 0);
  };

  const closeChatModal = () => {
    setChatOpen(false);
  };

  const handleScheduleChange = (key, value) => {
    setScheduleForm((current) => ({ ...current, [key]: value }));
  };

  const handleEmailChange = (key, value) => {
    setEmailForm((current) => ({ ...current, [key]: value }));
    setEmailErrors((current) => ({ ...current, [key]: false }));
  };

  const handleScheduleSubmit = async (event) => {
    event.preventDefault();
    if (!scheduleForm.date || !scheduleForm.time || !scheduleForm.email) {
      setScheduleStatus({ text: 'Please fill date, time and your email.', kind: 'error' });
      return;
    }
    setScheduleSending(true);
    setScheduleStatus({ text: 'Creating calendar file...', kind: '' });

    try {
      createICS(scheduleForm);
      const payload = {
        type: 'schedule',
        name: scheduleForm.name,
        email: scheduleForm.email,
        date: scheduleForm.date,
        time: scheduleForm.time,
        duration: scheduleForm.duration,
        notes: scheduleForm.notes,
      };
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setScheduleStatus({ text: 'Scheduled — notification sent. Thank you!', kind: 'ok' });
        setTimeout(() => {
          setScheduleForm({ name: '', email: '', date: '', time: '', duration: '30', notes: '' });
          closeScheduleModal();
        }, 1400);
      } else {
        setScheduleStatus({ text: 'Scheduled locally. Could not notify automatically; please email to confirm.', kind: 'error' });
      }
    } catch (error) {
      const mailto = `mailto:macxiaobin0517@gmail.com?subject=${encodeURIComponent(`Schedule request: ${scheduleForm.name || 'Guest'} - ${scheduleForm.date} ${scheduleForm.time}`)}&body=${encodeURIComponent(`Name: ${scheduleForm.name}\nEmail: ${scheduleForm.email}\nDate: ${scheduleForm.date}\nTime: ${scheduleForm.time}\nDuration: ${scheduleForm.duration} minutes\n\nNotes:\n${scheduleForm.notes}`)}`;
      window.location.href = mailto;
      setScheduleStatus({ text: 'Scheduled locally. Mail client opened to confirm the request.', kind: 'ok' });
      setTimeout(() => {
        setScheduleForm({ name: '', email: '', date: '', time: '', duration: '30', notes: '' });
        closeScheduleModal();
      }, 1400);
    } finally {
      setScheduleSending(false);
    }
  };

  const handleEmailSubmit = async (event) => {
    event.preventDefault();
    const errors = {};
    if (!emailForm.subject.trim()) {
      errors.subject = true;
    }
    if (!emailForm.message.trim()) {
      errors.message = true;
    }
    if (Object.keys(errors).length) {
      setEmailErrors(errors);
      setEmailStatus({ text: 'Please fill required fields.', kind: 'error' });
      return;
    }

    setEmailSending(true);
    setEmailStatus({ text: 'Sending...', kind: '' });

    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(emailForm),
      });

      if (response.ok) {
        setEmailStatus({ text: 'Message sent — thank you!', kind: 'ok' });
        setTimeout(() => {
          setEmailForm({ name: '', from: '', subject: '', message: '' });
          setEmailErrors({});
          closeEmailModal();
        }, 1400);
      } else {
        const data = await response.json().catch(() => null);
        setEmailStatus({ text: (data && data.error) || 'Send failed. Please try again later.', kind: 'error' });
      }
    } catch {
      setEmailStatus({ text: 'Network error — try again later.', kind: 'error' });
    } finally {
      setEmailSending(false);
    }
  };

  const updateGalleryAria = () => {
    if (!galleryTrackRef.current) {
      return;
    }
    const items = Array.from(galleryTrackRef.current.querySelectorAll('.gallery-item'));
    const trackRect = galleryTrackRef.current.getBoundingClientRect();
    const trackCenter = trackRect.left + trackRect.width / 2;
    let closest = null;
    let minDist = Infinity;

    items.forEach((item) => {
      const rect = item.getBoundingClientRect();
      const itemCenter = rect.left + rect.width / 2;
      const dist = Math.abs(itemCenter - trackCenter);
      if (dist < minDist) {
        minDist = dist;
        closest = item;
      }
      item.removeAttribute('aria-current');
    });

    if (closest) {
      closest.setAttribute('aria-current', 'true');
    }
  };

  useEffect(() => {
    if (!galleryTrackRef.current) {
      return undefined;
    }
    const track = galleryTrackRef.current;
    const onScroll = () => {
      window.clearTimeout(track._scrollTimer);
      track._scrollTimer = window.setTimeout(updateGalleryAria, 120);
    };
    track.addEventListener('scroll', onScroll);
    updateGalleryAria();
    return () => {
      track.removeEventListener('scroll', onScroll);
      window.clearTimeout(track._scrollTimer);
    };
  }, []);

  const focusGalleryNeighbor = (direction) => {
    if (!galleryTrackRef.current) {
      return;
    }
    const items = Array.from(galleryTrackRef.current.querySelectorAll('.gallery-item'));
    if (!items.length) {
      return;
    }
    const trackRect = galleryTrackRef.current.getBoundingClientRect();
    const center = trackRect.left + trackRect.width / 2;
    let closestIndex = 0;
    let minDist = Infinity;
    items.forEach((item, index) => {
      const rect = item.getBoundingClientRect();
      const itemCenter = rect.left + rect.width / 2;
      const dist = Math.abs(itemCenter - center);
      if (dist < minDist) {
        minDist = dist;
        closestIndex = index;
      }
    });
    const nextIndex = direction === 'next' ? (closestIndex + 1) % items.length : (closestIndex - 1 + items.length) % items.length;
    items[nextIndex].scrollIntoView({ behavior: 'smooth', inline: 'center' });
  };

  const renderTime = (timestamp) => {
    const date = new Date(timestamp || Date.now());
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const sendToGemini = async (text, userId) => {
    const botId = Date.now() + 1;
    setChatMessages((current) => [
      ...current,
      { id: botId, who: 'xiao', text: '', ts: Date.now(), status: 'pending' },
    ]);

    try {
      const streamUrl = CHAT_API_ENDPOINT.replace('/api/gemini_chat', '/api/gemini_stream');
      const response = await fetch(streamUrl, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Streaming API error');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const raw = decoder.decode(value, { stream: true });
        const chunk = parseSseData(raw);
        if (chunk) {
          accumulated += chunk;
          setChatMessages((current) =>
            current.map((message) =>
              message.id === botId ? { ...message, text: accumulated } : message
            )
          );
        }
      }

      setChatMessages((current) =>
        current.map((message) => {
          if (message.id === botId) {
            return { ...message, status: 'sent' };
          }
          if (message.id === userId) {
            return { ...message, status: 'sent' };
          }
          return message;
        })
      );
      setChatStatusText('Message sent — thank you!');
    } catch (error) {
      setChatMessages((current) =>
        current.map((message) => {
          if (message.id === botId || message.id === userId) {
            return { ...message, status: 'failed' };
          }
          return message;
        })
      );
      setChatStatusText('Could not send message to the AI backend.');
    }
  };

  const handleChatSubmit = async (event) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) {
      return;
    }
    const userId = Date.now();
    setChatMessages((current) => [
      ...current,
      { id: userId, who: 'user', text, ts: Date.now(), status: 'pending' },
    ]);
    setChatInput('');
    setChatStatusText('Sending...');
    await sendToGemini(text, userId);
  };

  const retryChatMessage = async (messageId) => {
    const message = chatMessages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }
    setChatMessages((current) =>
      current.map((item) =>
        item.id === messageId ? { ...item, status: 'pending' } : item
      )
    );
    setChatStatusText('Retrying...');
    await sendToGemini(message.text, messageId);
  };

  const exportChat = () => {
    const blob = new Blob([JSON.stringify(chatMessages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'chat-conversation.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const clearChat = () => {
    if (!window.confirm('Clear the conversation history?')) {
      return;
    }
    setChatMessages([]);
    window.localStorage.removeItem(CHAT_STORAGE_KEY);
    setChatStatusText('Conversation cleared.');
    setTimeout(() => setChatStatusText(''), 2000);
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <header className="mb-12">
        <div className="flex flex-row items-center gap-8">
          <div
            className="relative group w-44 h-44 flex-shrink-0 overflow-hidden rounded-2xl border border-zinc-800 shadow-2xl cursor-pointer"
            onClick={() => setThirdPhotoVisible((value) => !value)}
            onMouseLeave={() => setThirdPhotoVisible(false)}
            aria-label="Profile image toggle"
          >
            <img
              src={profileImages.primary}
              alt="Profile"
              className="profile-img absolute inset-0 w-full h-full object-cover transition-all duration-500 group-hover:opacity-0 group-hover:scale-110"
            />
            <img
              src={profileImages.hover}
              alt="Profile Hover"
              className="profile-img absolute inset-0 w-full h-full object-cover opacity-0 transition-all duration-500 scale-105 group-hover:opacity-100 group-hover:scale-100"
            />
            <img
              src={profileImages.third}
              alt="Profile Clicked"
              className={`profile-img absolute inset-0 w-full h-full object-cover transition-all duration-500 z-20 pointer-events-none ${thirdPhotoVisible ? 'opacity-100' : 'opacity-0'}`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-4xl font-bold tracking-tight text-white">Mac Xiaobin Villarusis</h1>
              <svg className="w-7 h-7 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.64.3 1.241.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
              </svg>
            </div>
            <p className="text-zinc-400 flex items-center gap-1.5 text-lg">
              <i className="fas fa-map-marker-alt text-sm" />
              Metro Manila, Philippines
            </p>
            <p className="text-zinc-300 text-xl font-medium mt-2">Software Engineer</p>
          </div>

          <button
            id="theme-toggle"
            aria-label="Toggle color theme"
            className="ml-auto p-0 rounded-full bg-transparent border-0"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            <span className="switch" aria-hidden="true">
              <span className="switch-knob">
                <i className={`fas ${theme === 'dark' ? 'fa-moon' : 'fa-sun'}`} />
              </span>
            </span>
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3 mb-6">
        <button
          type="button"
          className="cta-btn bg-white text-black hover:bg-gray-200"
          aria-haspopup="dialog"
          aria-controls="schedule-modal"
          onClick={openScheduleModal}
        >
          <i className="far fa-calendar" /> Schedule a Call <i className="fas fa-chevron-right text-xs" />
        </button>
        <button
          type="button"
          className="cta-btn text-gray-300"
          aria-haspopup="dialog"
          aria-controls="email-modal"
          onClick={openEmailModal}
        >
          <i className="far fa-envelope" /> Send Email
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 flex flex-col gap-4">
          <section className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <i className="fas fa-briefcase text-gray-400" />
              <h2 className="font-bold text-lg">About</h2>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed mb-4">
              I'm a full-stack Software Engineer specializing in developing solutions with JavaScript, Python, PHP, and Laravel. I work on projects including building modern web applications, mobile apps, search engine optimization, and digital marketing with minimalism and functionality.
            </p>
            <p className="text-gray-400 text-sm leading-relaxed mb-4">
              I Graduated from University of Batangas with a degree in Bachelor of Science in Computer Engineering.
            </p>
            <p className="text-gray-400 text-sm leading-relaxed">
              I specialized in Software Engineering, Machine Learning, and Security. My work includes developing AI-powered solutions, creating applications with generative AI to optimize development workflows, and delivering cutting-edge technology.
            </p>
          </section>

          <section className="card p-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <i className="fas fa-shapes text-gray-400" />
                <h2 className="font-bold text-lg">Tech Stack</h2>
              </div>
              <span className="text-xs text-gray-500 cursor-pointer"><i className="fas fa-chevron-right" /></span>
            </div>
            {content.techStacks.map((stack) => (
              <div key={stack.title} className="mb-4">
                <h3 className="text-sm font-semibold mb-2">{stack.title}</h3>
                <div>
                  {stack.items.map((item) => (
                    <span key={item} className="badge">{item}</span>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section className="card p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <i className="fas fa-book-open text-gray-400" />
                  <h2 className="font-bold text-lg">Beyond Coding</h2>
                </div>
                <p className="text-gray-400 text-sm leading-relaxed mb-4">
                  When not writing code, I focus on learning about emerging technologies, minimalism, and personal productivity.
                </p>
                <p className="text-gray-400 text-sm leading-relaxed mb-4">
                  I share my knowledge through online bootcamps and community building.
                </p>
                <p className="text-gray-400 text-sm leading-relaxed mb-4">
                  I take free Certifications Online when not coding, enhancing my knowledge and skills.
                </p>
                <p className="text-gray-400 text-sm leading-relaxed mb-4">
                  I listen to Podcasts about Technology, Software Development, and Emerging Tech.
                </p>
                <p className="text-gray-400 text-sm leading-relaxed mb-4">
                  I jog &amp; walk every Monday to Friday; on weekends I play Volleyball. I do this for my mental health and physical health.
                </p>
              </div>
            </section>

            <section className="card p-6">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <i className="fas fa-th-large text-gray-400" />
                  <h2 className="font-bold text-lg">Recent Projects</h2>
                </div>
                <span className="text-xs text-gray-500 cursor-pointer"><i className="fas fa-chevron-right" /></span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {content.projects.map((project) => (
                  <a
                    key={project.title}
                    href={project.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="project-card p-3 block border border-transparent hover:border-gray-700 hover:bg-white/5 transition-all duration-200 rounded-lg"
                  >
                    <h4 className="font-bold text-sm text-white">{project.title}</h4>
                    <p className="text-xs text-gray-400 mb-2">{project.description}</p>
                    <span className="bg-black text-gray-300 text-[10px] px-2 py-1 rounded border border-gray-800 font-mono">{project.label}</span>
                  </a>
                ))}
              </div>
            </section>
          </div>

          <section className="card p-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <i className="fas fa-check-circle text-gray-400" />
                <h2 className="font-bold text-lg">Recent Certifications</h2>
              </div>
              <a href="/certifications.html" className="text-xs text-gray-500 hover:text-white transition-colors">
                View All <i className="fas fa-chevron-right ml-1" />
              </a>
            </div>
            <div className="space-y-3">
              {content.certifications.map((cert) => (
                <div key={cert.title} className="project-card p-3">
                  <h4 className="font-bold text-sm">{cert.title}</h4>
                  <p className="text-xs text-gray-400">{cert.subtitle}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="lg:col-span-4 flex flex-col gap-4">
          <section className="card p-6">
            <div className="flex items-center gap-2 mb-6">
              <i className="fas fa-briefcase text-gray-400" />
              <h2 className="font-bold text-lg">Experience</h2>
            </div>
            <div className="pl-2">
              {content.experiences.map((item, index) => (
                <div key={`${item.title}-${index}`} className="timeline-line pl-6 pb-8 relative">
                  <div className="timeline-dot" />
                  <h3 className="font-bold text-sm text-white">{item.title}</h3>
                  <div className="flex justify-between items-start">
                    <p className="text-xs text-gray-400">{item.company}</p>
                    <span className="border border-gray-700 text-[10px] px-2 py-0.5 rounded-full text-gray-300">{item.year}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="relative w-full max-w-md overflow-hidden bg-black text-white rounded-xl shadow-2xl border border-gray-800">
            <div className="flex transition-transform duration-500 ease-in-out" style={{ transform: `translateX(-${currentSlide * 100}%)` }}>
              {content.recommendations.map((item) => (
                <article key={item.author} className="min-w-full p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <i className="fas fa-comment-alt text-gray-400" />
                    <h2 className="font-bold text-lg">Recommendations</h2>
                  </div>
                  <p className="text-gray-400 text-sm italic mb-4 leading-relaxed">{item.text}</p>
                  <div>
                    <h4 className="font-bold text-sm">{item.author}</h4>
                    <p className="text-xs text-gray-500">{item.role}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="flex gap-1 p-6 pt-0" id="dots">
              {content.recommendations.map((_, index) => (
                <div
                  key={index}
                  className={`dot w-1.5 h-1.5 rounded-full ${index === currentSlide ? 'bg-white' : 'bg-gray-600'}`}
                />
              ))}
            </div>
          </section>
        </aside>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <section className="card p-4 flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2 text-gray-400 text-sm">
            <i className="fas fa-users" /> A member of
          </div>
          <div className="space-y-2">
            {content.organizations.map((item) => (
              <a
                key={item.label}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-gray-700 rounded p-2 flex justify-between items-center text-xs hover:bg-zinc-900 transition hover:border-zinc-500 group"
              >
                <span>{item.label}</span>
                <i className="fas fa-external-link-alt text-gray-500 group-hover:text-blue-400 transition" />
              </a>
            ))}
          </div>
        </section>

        <section className="card p-4 flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2 text-gray-400 text-sm">
            <i className="fas fa-link" /> Social Links
          </div>
          <div className="space-y-2">
            {content.socialLinks.map((item) => (
              <a
                key={item.label}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="social-link-card border border-gray-700 rounded p-2 flex items-center gap-3 text-sm transition-all"
              >
                <i className={`${item.icon} text-xl`} style={{ color: item.color }} />
                <span className="text-gray-300">{item.label}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="card p-4 flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2 text-gray-400 text-sm">
            <i className="fas fa-microphone" /> Meet Me
          </div>
          <p className="text-medium text-gray-400 mt-2 mb-auto">
            Available for online bootcamps and events about software development and emerging technologies.
          </p>
          <p className="text-medium text-gray-400 mt-2 mb-auto">
            Meet me at University of Batangas.
          </p>
        </section>

        <div className="flex flex-col gap-2">
          <div className="card p-3 flex justify-between items-center cursor-pointer hover:bg-[#18181b]">
            <div className="flex flex-col">
              <span className="text-xs text-gray-400"><i className="far fa-envelope mr-1" /> Email</span>
              <span className="text-sm font-medium">macxiaobin0517@gmail.com</span>
            </div>
          </div>
          <div className="card p-3 flex justify-between items-center cursor-pointer hover:bg-[#18181b]">
            <div className="flex flex-col">
              <span className="text-xs text-gray-400"><i className="far fa-calendar mr-1" /> Let's Talk</span>
              <span className="text-sm font-medium">Schedule a Call</span>
            </div>
            <i className="fas fa-chevron-right text-sm" />
          </div>
          <div className="card p-3 flex justify-between items-center cursor-pointer hover:bg-[#18181b]">
            <div className="flex flex-col">
              <span className="text-xs text-gray-400"><i className="fas fa-users mr-1" /> Community</span>
              <span className="text-sm font-medium">Join Discussion</span>
            </div>
            <i className="fas fa-chevron-right text-sm" />
          </div>
        </div>
      </div>

      <section className="card p-6 mt-4 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <i className="far fa-image text-gray-400" />
          <h2 className="font-bold text-lg">Gallery</h2>
        </div>
        <div className="relative">
          <div
            ref={galleryTrackRef}
            className="gallery-track flex gap-4 overflow-x-auto no-scrollbar"
            tabIndex={0}
            aria-label="Photo gallery"
            role="list"
          >
            {content.gallery.map((item) => (
              <img
                key={item.src}
                src={item.src}
                alt={item.alt}
                className="gallery-item rounded-lg h-48 w-auto object-cover opacity-80 hover:opacity-100 transition"
                role="listitem"
              />
            ))}
          </div>
          <button
            id="gallery-prev"
            type="button"
            className="absolute left-0 top-1/2 -translate-y-1/2 bg-black/50 p-2 rounded-full border border-gray-600 text-white hover:bg-black focus:outline-none"
            aria-label="Previous image"
            onClick={() => focusGalleryNeighbor('prev')}
          >
            <i className="fas fa-chevron-left" />
          </button>
          <button
            id="gallery-next"
            type="button"
            className="absolute right-0 top-1/2 -translate-y-1/2 bg-black/50 p-2 rounded-full border border-gray-600 text-white hover:bg-black focus:outline-none"
            aria-label="Next image"
            onClick={() => focusGalleryNeighbor('next')}
          >
            <i className="fas fa-chevron-right" />
          </button>
        </div>
      </section>

      <Modal open={scheduleOpen} onClose={closeScheduleModal} titleId="schedule-modal-title">
        <h3 id="schedule-modal-title" className="font-bold text-lg">Schedule a Call</h3>
        <form className="mt-4" onSubmit={handleScheduleSubmit} noValidate>
          <div className="mb-3">
            <label className="text-xs text-gray-400">Your Name</label>
            <input
              ref={scheduleFirstInput}
              type="text"
              name="name"
              value={scheduleForm.name}
              onChange={(event) => handleScheduleChange('name', event.target.value)}
              className="input-field w-full p-2 mt-1 rounded border"
              placeholder="Your name"
            />
          </div>
          <div className="mb-3">
            <label className="text-xs text-gray-400">Your Email</label>
            <input
              type="email"
              name="email"
              value={scheduleForm.email}
              onChange={(event) => handleScheduleChange('email', event.target.value)}
              className="input-field w-full p-2 mt-1 rounded border"
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400">Date</label>
              <input
                type="date"
                name="date"
                value={scheduleForm.date}
                min={new Date().toISOString().split('T')[0]}
                onChange={(event) => handleScheduleChange('date', event.target.value)}
                className="input-field w-full p-2 mt-1 rounded border"
                required
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Time</label>
              <input
                type="time"
                name="time"
                value={scheduleForm.time}
                onChange={(event) => handleScheduleChange('time', event.target.value)}
                className="input-field w-full p-2 mt-1 rounded border"
                required
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="text-xs text-gray-400">Duration</label>
            <select
              name="duration"
              value={scheduleForm.duration}
              onChange={(event) => handleScheduleChange('duration', event.target.value)}
              className="input-field w-full p-2 mt-1 rounded border"
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">60 minutes</option>
            </select>
          </div>
          <div className="mb-3">
            <label className="text-xs text-gray-400">Notes (optional)</label>
            <textarea
              name="notes"
              value={scheduleForm.notes}
              onChange={(event) => handleScheduleChange('notes', event.target.value)}
              className="input-field w-full p-2 mt-1 rounded border"
              rows={3}
              placeholder="Any details..."
            />
          </div>
          <div className="p-3 mt-3 rounded border bg-transparent text-sm flex items-start gap-3">
            <div className="preview-icon mt-1 text-gray-400"><i className="far fa-calendar-alt" /></div>
            <div className="flex-1">
              <strong>Preview:</strong>
              <div className="mt-2 text-sm text-gray-400">{schedulePreview ? schedulePreview.text : 'Select a date and time to see a preview.'}</div>
              <div className="mt-1 text-xs text-gray-500">{schedulePreview ? `UTC: ${schedulePreview.utcText}` : ''}</div>
              <div className="mt-1 text-xs text-gray-500">{schedulePreview ? `Time zone: ${schedulePreview.tz}` : ''}</div>
            </div>
          </div>
          <div className={`text-sm mt-2 ${scheduleStatus.kind === 'ok' ? 'status-success' : scheduleStatus.kind === 'error' ? 'status-error' : ''}`} aria-live="polite">
            {scheduleStatus.text}
          </div>
          <div className="flex gap-2 justify-end mt-3">
            <button type="submit" className="cta-btn bg-white text-black" disabled={!scheduleForm.date || !scheduleForm.time || !scheduleForm.email || scheduleSending}>
              Confirm & Download
            </button>
            <button type="button" className="cta-btn" onClick={closeScheduleModal}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={emailOpen} onClose={closeEmailModal} titleId="email-modal-title">
        <h3 id="email-modal-title" className="font-bold text-lg">Send an Email</h3>
        <form className="mt-4" onSubmit={handleEmailSubmit} noValidate>
          <div className="mb-3">
            <label className="text-xs text-gray-400">Your Name (Required)</label>
            <input
              ref={emailFirstInput}
              type="text"
              name="name"
              value={emailForm.name}
              onChange={(event) => handleEmailChange('name', event.target.value)}
              className="input-field w-full p-2 mt-1 rounded border"
              placeholder="Your name"
            />
          </div>
          <div className="mb-3">
            <label className="text-xs text-gray-400">Your Email (optional)</label>
            <input
              type="email"
              name="from"
              value={emailForm.from}
              onChange={(event) => handleEmailChange('from', event.target.value)}
              className="input-field w-full p-2 mt-1 rounded border"
              placeholder="you@example.com"
            />
          </div>
          <div className="mb-3">
            <label className="text-xs text-gray-400">Subject</label>
            <input
              id="email-subject"
              type="text"
              name="subject"
              value={emailForm.subject}
              onChange={(event) => handleEmailChange('subject', event.target.value)}
              required
              className="input-field w-full p-2 mt-1 rounded border"
              placeholder="Subject"
            />
            {emailErrors.subject && <p className="form-error text-xs mt-1">Subject is required.</p>}
          </div>
          <div className="mb-3">
            <label className="text-xs text-gray-400">Message</label>
            <textarea
              id="email-message"
              name="message"
              value={emailForm.message}
              onChange={(event) => handleEmailChange('message', event.target.value)}
              required
              className="input-field w-full p-2 mt-1 rounded border"
              rows={5}
              placeholder="Write your message"
            />
            {emailErrors.message && <p className="form-error text-xs mt-1">Message is required.</p>}
          </div>
          <div className={`text-sm mt-2 ${emailStatus.kind === 'ok' ? 'status-success' : emailStatus.kind === 'error' ? 'status-error' : ''}`} aria-live="polite">
            {emailStatus.text}
          </div>
          <div className="flex gap-2 justify-end mt-3">
            <button type="submit" className="cta-btn bg-white text-black" disabled={emailSending}>
              Send
            </button>
            <button type="button" className="cta-btn" onClick={closeEmailModal}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={chatOpen} onClose={closeChatModal} titleId="chat-modal-title" className="p-0 max-w-sm w-full overflow-hidden">
        <header className="flex items-center gap-3 px-3 py-2 bg-[#06121a] text-white">
          <div className="flex items-center gap-3">
            <img src="/assets/profile1.png" alt="Avatar" className="w-9 h-9 rounded-full border" />
            <div>
              <div className="font-semibold" id="chat-title">Chat with Xiao</div>
              <div className="text-xs text-green-400" id="chat-presence">{presenceOnline ? 'Online' : 'Offline'}</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="cta-btn" onClick={exportChat} title="Export conversation">
              Export
            </button>
            <button type="button" className="cta-btn" onClick={clearChat} title="Clear conversation">
              Clear
            </button>
            <button type="button" className="cta-btn" onClick={() => setPresenceOnline((value) => !value)} title="Toggle presence">
              {presenceOnline ? 'Go offline' : 'Go online'}
            </button>
            <button type="button" className="ml-1 cta-btn" onClick={closeChatModal} aria-label="Close chat">
              ✕
            </button>
          </div>
        </header>
        <div className="chat-toolbar px-3 py-2 bg-[#06121a]">
          <input
            id="chat-search"
            placeholder="Search messages"
            value={chatSearch}
            onChange={(event) => setChatSearch(event.target.value)}
            className="input-field p-2 rounded border bg-[#071018] text-white w-full"
          />
        </div>
        <div id="chat-thread" className="chat-thread mb-0 overflow-y-auto bg-[#030507]" style={{ maxHeight: '42vh' }}>
          {filteredChatMessages.map((message) => (
            <div key={message.id} className={`chat-msg ${message.who === 'user' ? 'justify-end' : 'justify-start'} flex py-2 px-3`}>
              <div className={`rounded-3xl p-4 max-w-[85%] ${message.who === 'user' ? 'bg-white text-black' : 'bg-[#131a22] text-gray-300'}`}>
                <p className="whitespace-pre-wrap text-sm">{message.text}</p>
                <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-gray-400">
                  <span>{renderTime(message.ts)}</span>
                  {message.status === 'pending' && <span>Sending...</span>}
                  {message.status === 'failed' && (
                    <button
                      type="button"
                      className="text-xs text-red-300 underline"
                      onClick={() => retryChatMessage(message.id)}
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <form id="chat-form" className="px-3 py-2 flex items-end gap-2 bg-[#030507]" onSubmit={handleChatSubmit}>
          <input
            ref={chatInputRef}
            id="chat-input"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            className="input-field flex-1 p-3 rounded border bg-[#07090b] text-white"
            placeholder="Type a message..."
            aria-label="Message"
            maxLength={1000}
            required
          />
          <button type="submit" className="cta-btn chat-send bg-white text-black" aria-label="Send message">
            ➤
          </button>
        </form>
        <div className="px-3 pb-3 flex items-center justify-between text-xs text-gray-400">
          <div>Ask me about programming, web dev, or tech!</div>
          <div id="chat-count">{chatInput.length}/1000</div>
        </div>
      </Modal>

      <footer className="text-center text-gray-500 text-sm pb-10">
        © 2026 Mac Xiaobin Villacusis. All rights reserved.
      </footer>

      <div className="fixed bottom-6 right-6 z-50">
        <button
          id="chat-btn"
          type="button"
          className="chat-btn bg-white text-black px-5 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 hover:bg-gray-200 transition"
          aria-label="Chat with Xiao"
          onClick={openChatModal}
        >
          <i className="far fa-comment-dots text-lg" /> Chat with Xiao
        </button>
      </div>
    </div>
  );
}
