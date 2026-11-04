"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowRight, BarChart3, CalendarDays, Check, ChevronLeft, ChevronRight,
  CircleHelp, ClipboardList, Flame, Globe2, Heart, Info, Leaf, LoaderCircle, LogIn, LogOut,
  Menu, Minus, Plus, ScanLine, Settings2, ShieldCheck, Sparkles, Target, Trash2, TrendingDown,
  UserRound, Wallet, Weight, X,
} from "lucide-react";
import type { DiaryItem, Locale, Profile, SessionUser, View, WeightItem } from "@/lib/types";
import { defaultProfile } from "@/lib/types";
import { calculatePlan, localDate, sumDiary } from "@/lib/calories";
import { intlLocale, localeNames, translations } from "@/lib/i18n";
import { profileSchema } from "@/lib/validations";
import { ScannerView } from "./scanner";

const todayDate = () => localDate();
const calendarDisplay = (date: string, locale: Locale, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) =>
  new Intl.DateTimeFormat(intlLocale[locale], options).format(new Date(`${date}T12:00:00`));
const dayShift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return localDate(d);
};
const formatNum = (num: number, locale: Locale, digits = 0) => new Intl.NumberFormat(intlLocale[locale], { maximumFractionDigits: digits }).format(num);

async function api<T>(url: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: object): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined, credentials: "same-origin", cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

type StateResponse = { profile: Profile | null; diary: DiaryItem[]; weights: WeightItem[] };
const navIcons = { dashboard: BarChart3, scanner: ScanLine, diary: ClipboardList, profile: UserRound } as const;
const navKeys = { dashboard: "navDash", scanner: "navScan", diary: "navDiary", profile: "navProfile" } as const;

export function KaloApp() {
  const [locale, setLocale] = useState<Locale>("uz");
  const [view, setView] = useState<View>("dashboard");
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [diary, setDiary] = useState<DiaryItem[]>([]);
  const [weights, setWeights] = useState<WeightItem[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [dbConfigured, setDbConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [authOpen, setAuthOpen] = useState<"login" | "signup" | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const t = translations[locale];
  const plan = useMemo(() => calculatePlan(profile), [profile]);
  const today = todayDate();
  const dayItems = diary.filter(x => x.date === selectedDate);
  const todaysItems = diary.filter(x => x.date === today);
  const totals = sumDiary(todaysItems);
  const remaining = plan.suggestedCalories - totals.kcal;
  const percent = Math.min(100, (totals.kcal / Math.max(1, plan.suggestedCalories)) * 100);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast(current => current?.text === text ? null : current), 4500);
  }, []);

  useEffect(() => {
    const savedLocale = localStorage.getItem("kalo_locale");
    if (savedLocale === "en" || savedLocale === "uz" || savedLocale === "ru" || savedLocale === "lv") setLocale(savedLocale);
    const restoreLocal = () => {
      try {
        const stored = localStorage.getItem("kalo_demo");
        if (!stored) return;
        const d = JSON.parse(stored) as { profile?: Profile; diary?: DiaryItem[]; weights?: WeightItem[] };
        if (d.profile && profileSchema.safeParse(d.profile).success) setProfile(d.profile);
        if (Array.isArray(d.diary)) setDiary(d.diary);
        if (Array.isArray(d.weights)) setWeights(d.weights);
      } catch { /* Ignore broken local demo data */ }
    };
    restoreLocal();
    void (async () => {
      try {
        const status = await api<{ user: SessionUser | null; databaseConfigured: boolean }>("/api/auth/me");
        setDbConfigured(status.databaseConfigured);
        if (status.user) {
          const data = await api<StateResponse>("/api/state");
          setUser(status.user);
          if (data.profile) setProfile(data.profile);
          setDiary(data.diary); setWeights(data.weights);
        }
      } catch { /* Demo works without any database */ }
      finally { setLoaded(true); }
    })();
  }, []);

  useEffect(() => { if (loaded) localStorage.setItem("kalo_locale", locale); }, [locale, loaded]);
  useEffect(() => {
    if (loaded && !user) localStorage.setItem("kalo_demo", JSON.stringify({ profile, diary, weights }));
  }, [loaded, user, profile, diary, weights]);

  const switchView = (next: View) => { setView(next); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const refreshAccount = async (signedInUser: SessionUser) => {
    const data = await api<StateResponse>("/api/state");
    setUser(signedInUser);
    setProfile(data.profile ?? defaultProfile);
    setDiary(data.diary); setWeights(data.weights);
  };
  const signIn = async (mode: "signup" | "login", input: { name: string; email: string; password: string }) => {
    const { user: newUser } = await api<{ user: SessionUser }>(`/api/auth/${mode === "signup" ? "register" : "login"}`, "POST", input);
    if (mode === "signup") {
      // Keep browser demo data when creating an account for the first time.
      try {
        await api("/api/profile", "PUT", profile);
        for (const item of weights.slice(0, 180)) await api("/api/weights", "POST", { date: item.date, kg: item.kg });
        for (const { id: _id, ...item } of diary.slice(0, 250)) await api("/api/diary", "POST", item);
      } catch { notify(t.genericError, true); }
    }
    await refreshAccount(newUser);
    setAuthOpen(null);
    notify(t.accountSaved);
  };
  const logout = async () => {
    try { await api("/api/auth/logout", "POST"); }
    catch (e) { notify(e instanceof Error ? e.message : t.genericError, true); return; }
    setUser(null);
    try {
      const local = JSON.parse(localStorage.getItem("kalo_demo") || "{}");
      setProfile(profileSchema.safeParse(local.profile).success ? local.profile : defaultProfile);
      setDiary(Array.isArray(local.diary) ? local.diary : []);
      setWeights(Array.isArray(local.weights) ? local.weights : []);
    } catch { setProfile(defaultProfile); setDiary([]); setWeights([]); }
  };
  const addEntry = async (item: Omit<DiaryItem, "id">) => {
    const created = user ? (await api<{ entry: DiaryItem }>("/api/diary", "POST", item)).entry
      : { ...item, id: crypto.randomUUID() };
    setDiary(old => [created, ...old]);
    setSelectedDate(item.date);
  };
  const removeEntry = async (id: string) => {
    try {
      if (user) await api(`/api/diary/${id}`, "DELETE");
      setDiary(old => old.filter(x => x.id !== id));
    } catch (e) { notify(e instanceof Error ? e.message : t.genericError, true); }
  };
  const saveProfile = async (next: Profile) => {
    const valid = profileSchema.safeParse(next);
    if (!valid.success) throw new Error(t.formError);
    if (user) await api("/api/profile", "PUT", next);
    setProfile(next); notify(t.saved);
  };
  const addWeight = async (date: string, kg: number) => {
    if (!Number.isFinite(kg) || kg < 30 || kg > 400) throw new Error(t.formError);
    let newItem: WeightItem = { id: crypto.randomUUID(), date, kg };
    if (user) newItem = (await api<{ item: WeightItem }>("/api/weights", "POST", { date, kg })).item;
    const latest = [...weights].sort((a,b) => b.date.localeCompare(a.date))[0];
    setWeights(old => [newItem, ...old.filter(x => x.date !== date)]);
    if (!latest || date >= latest.date) setProfile(old => ({ ...old, weightKg: kg }));
    notify(t.weightSaved);
  };

  return <div className="app-shell">
    <aside className={`app-sidebar ${menuOpen ? "sidebar-show" : ""}`}>
      <button className="sidebar-mobile-close" onClick={() => setMenuOpen(false)} aria-label={t.close}><X size={20}/></button>
      <div className="brand" onClick={() => switchView("dashboard")} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && switchView("dashboard")}>
        <span className="brand-mark">k<span>.</span></span><div><strong>kalo</strong><small>FEEL GOOD, LIVE WELL</small></div>
      </div>
      <div className="sidebar-label">{t.yourSpace}</div>
      <nav className="nav-list" aria-label="Main navigation">
        {(Object.keys(navIcons) as View[]).map(key => {
          const Icon = navIcons[key]; return <button key={key} type="button" onClick={() => switchView(key)} className={`nav-item ${view === key ? "active" : ""}`}>
            <Icon size={19} strokeWidth={1.8}/><span>{t[navKeys[key]]}</span>{view === key && <span className="nav-dot"/>}
          </button>;
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-mini-card"><div className="sidebar-mini-illustration"><Heart size={23} fill="currentColor"/></div>
          <strong>{t.healthJourney}</strong><span>{t.madeFor}</span></div>
        <div className="sidebar-brand-footer"><span className="footer-sparkle"><Leaf size={17}/></span><span>Made for balance <span>✳</span></span></div>
      </div>
    </aside>
    {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label={t.close}/>}
    <main className="main-area">
      <div className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={22}/></button>
        <span className="today-dot"/><span className="topbar-date">{calendarDisplay(today, locale, { weekday: "long", day: "numeric", month: "long" })}</span></div>
        <div className="topbar-right"><div className="language-select"><Globe2 size={17}/><select value={locale} onChange={e => setLocale(e.target.value as Locale)} aria-label={t.language}>
          {(Object.keys(localeNames) as Locale[]).map(l => <option value={l} key={l}>{localeNames[l]}</option>)}</select></div>
          {user ? <button className="profile-chip" onClick={() => switchView("profile")}><span className="avatar">{user.name.charAt(0).toUpperCase()}</span><span className="profile-chip-name">{user.name}</span></button>
            : <button className="btn btn-signin" onClick={() => setAuthOpen("signup")}><UserRound size={17}/><span>{t.signup}</span></button>}
        </div></div>
      {!loaded && <div className="initial-loading"><LoaderCircle size={29} className="spin"/> KALO</div>}
      {loaded && <>
        {!user && <div className="demo-banner"><span className="demo-pill"><Sparkles size={13}/>{t.demo}</span><span>{t.demoNotice}</span><button onClick={() => setAuthOpen("signup")}>{t.saveAccount}<ArrowRight size={15}/></button></div>}
        {view === "dashboard" && <Dashboard locale={locale} profile={profile} diary={diary} weights={weights} plan={plan} today={today} total={totals.kcal} remaining={remaining} percent={percent} onNavigate={switchView}/ >}
        {view === "scanner" && <ScannerView locale={locale} addEntry={addEntry} notify={notify} today={today}/ >}
        {view === "diary" && <DiaryView locale={locale} items={dayItems} date={selectedDate} onDate={setSelectedDate} remove={removeEntry} navigate={switchView}/ >}
        {view === "profile" && <ProfileView locale={locale} profile={profile} plan={plan} weights={weights} onSave={saveProfile} onWeight={addWeight}
          user={user} dbConfigured={dbConfigured} openAuth={setAuthOpen} logout={logout}/ >}
        <footer className="page-footer"><span>© 2026 KALO</span><span><Leaf size={13}/>{t.madeFor}</span></footer>
      </>}
    </main>
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{(Object.keys(navIcons) as View[]).map(key => {const Icon = navIcons[key]; return <button key={key} className={view === key ? "active" : ""} onClick={() => switchView(key)}><Icon size={21}/><span>{t[navKeys[key]]}</span></button>;})}</nav>
    {toast && <div className={`toast ${toast.error ? "toast-error" : ""}`} role="status">{toast.error ? <Info size={18}/> : <Check size={18}/>}<span>{toast.text}</span><button onClick={() => setToast(null)} aria-label={t.close}><X size={16}/></button></div>}
    {authOpen && <AuthModal mode={authOpen} setMode={setAuthOpen} locale={locale} dbConfigured={dbConfigured} submit={signIn}/>}
  </div>;
}

function PanelHeading({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children}</div>;
}

function Dashboard({locale,profile,diary,weights,plan,today,total,remaining,percent,onNavigate}: {
  locale: Locale; profile: Profile; diary: DiaryItem[]; weights: WeightItem[]; plan: ReturnType<typeof calculatePlan>;
  today: string; total: number; remaining: number; percent: number; onNavigate: (v: View)=>void;
}) {
  const t = translations[locale];
  const week = Array.from({ length: 7 }, (_, i) => dayShift(today, i - 6));
  const chartValues = week.map(date => sumDiary(diary.filter(x => x.date === date)).kcal);
  const maxBar = Math.max(...chartValues, plan.suggestedCalories, 1);
  const todays = sumDiary(diary.filter(x => x.date === today));
  return <div className="view fade-in">
    <div className="hero"><div><span className="hero-eyebrow"><Sparkles size={15}/> {t.yourSpace}</span><h1>{t.greeting}</h1><p>{t.greetingSub}</p>
      <button className="btn btn-hero" onClick={() => onNavigate("scanner")}>{t.scanNow}<ArrowRight size={18}/></button></div>
      <div className="hero-decoration"><span className="blob-one"/><span className="blob-two"/><div className="hero-leaf"><Leaf size={90} strokeWidth={1.15}/></div><div className="hero-float"><Flame size={17}/><span>{formatNum(plan.suggestedCalories, locale)} {t.kcal}<small>{t.dailyGoal}</small></span></div></div></div>
    <div className="section-line"><div><span className="eyebrow">{t.today.toUpperCase()}</span><h2>{t.overview}</h2><p>{t.overviewSub}</p></div><span className="date-chip"><CalendarDays size={16}/>{calendarDisplay(today, locale, { day: "numeric", month: "short" })}</span></div>
    <div className="stat-grid">
      <StatCard icon={<Target size={20}/>} color="green" name={t.dailyGoal} value={formatNum(plan.suggestedCalories,locale)} suffix={t.kcal} sub={`${t.maintenance}: ${formatNum(plan.maintenance,locale)}`}/>
      <StatCard icon={<Flame size={20}/>} color="orange" name={t.eaten} value={formatNum(total,locale)} suffix={t.kcal} sub={`${Math.round(percent)}% ${t.ofGoal}`}/>
      <StatCard icon={<ArrowDownRight size={20}/>} color="blue" name={t.remaining} value={formatNum(remaining,locale)} suffix={t.kcal} sub={t.dailyGoal}/>
      <StatCard icon={<TrendingDown size={20}/>} color="violet" name={t.dailyDeficit} value={formatNum(plan.deficit,locale)} suffix={t.kcal} sub={`${plan.projectedWeeklyKg} ${t.kg} / ${t.weeks.toLowerCase()}`}/>
    </div>
    <div className="dashboard-two-col">
      <div className="card progress-panel"><PanelHeading title={t.todayProgress} subtitle={t.progressSub}/>
        <div className="progress-inner"><div className="ring" style={{ background: `conic-gradient(#3b8063 ${percent}%, #e9eee9 ${percent}% 100%)` }}><div className="ring-inner"><span>{Math.round(percent)}%</span><small>{t.ofGoal}</small></div></div>
          <div className="progress-summary"><div><span>{t.eaten}</span><strong>{formatNum(total,locale)} <small>{t.kcal}</small></strong></div><div><span>{t.remaining}</span><strong>{formatNum(remaining,locale)} <small>{t.kcal}</small></strong></div>
            <div className="subtle-divider"/><span className="progress-goal">{t.dailyGoal}: {formatNum(plan.suggestedCalories,locale)} {t.kcal}</span></div></div>
        <div className="macro-row">{([[t.protein,todays.protein,"protein"],[t.carbs,todays.carbs,"carbs"],[t.fat,todays.fat,"fat"]] as [string,number,string][]).map(([label,value,cls]) =>
          <div className="macro-block" key={cls}><span className={`macro-dot ${cls}`}/><div><small>{label}</small><strong>{formatNum(value,locale,1)} <span>{t.grams}</span></strong></div></div>)}</div>
      </div>
      <div className="card weekly-panel"><PanelHeading title={t.weekly} subtitle={t.weeklySub}/><div className="bar-chart">
        {week.map((date,i) => <div key={date} className="chart-column"><div className="chart-bar-area"><div className={`chart-bar ${date===today?"current":""}`} title={`${chartValues[i]} ${t.kcal}`} style={{height: `${Math.max(4, chartValues[i]/maxBar*158)}px`}}/>
            {date===today && <span className="bar-today-dot"/>}</div><span className="bar-label">{calendarDisplay(date, locale, {weekday:"short"})}</span></div>)}
      </div><div className="chart-legend"><span className="legend-dot"/>{t.kcal}</div></div>
    </div>
    <div className="dashboard-two-col bottom-two-col">
      <div className="card weight-panel"><PanelHeading title={t.trend} subtitle={t.trendSub}><button className="text-action" onClick={() => onNavigate("profile")}>{t.navProfile}<ChevronRight size={16}/></button></PanelHeading><WeightChart weights={weights} locale={locale} empty={t.noWeight}/></div>
      <div className="cta-panel"><div className="cta-art"><ScanLine size={59} strokeWidth={1.2}/></div><div><span className="eyebrow">KALO</span><h2>{t.startScanning}</h2><p>{t.scanPitch}</p><button className="btn btn-white" onClick={() => onNavigate("scanner")}>{t.scanNow}<ArrowRight size={16}/></button></div></div>
    </div>
    <div className="card plan-strip"><div className="plan-strip-top"><span className="eyebrow"><Target size={14}/>{t.planTitle}</span><button onClick={() => onNavigate("profile")} className="text-action">{t.navProfile}<ChevronRight size={16}/></button></div>
      <div className="plan-strip-grid"><div><small>{t.bmr}</small><strong>{formatNum(plan.bmr,locale)} <em>{t.kcal}</em></strong></div><div><small>{t.maintenance}</small><strong>{formatNum(plan.maintenance,locale)} <em>{t.kcal}</em></strong></div><div><small>{t.weeklyLoss}</small><strong>≈ {plan.projectedWeeklyKg} <em>{t.kg}</em></strong></div><div><small>{t.toGoal}</small><strong>{plan.weeks ?? "—"} <em>{t.weeks}</em></strong></div></div>
      {plan.floorApplied && <p className="soft-warning"><Info size={15}/>{t.floorNote}</p>}
    </div>
  </div>;
}

function StatCard({icon,color,name,value,suffix,sub}:{icon:React.ReactNode;color:string;name:string;value:string;suffix:string;sub:string}) {
  return <div className="stat-card"><div className="stat-top"><span className={`stat-icon ${color}`}>{icon}</span><span className="stat-mini-wave">↗</span></div><span className="stat-name">{name}</span><div className="stat-value">{value} <small>{suffix}</small></div><span className="stat-sub">{sub}</span></div>;
}

function WeightChart({weights,locale,empty}:{weights:WeightItem[];locale:Locale;empty:string}) {
  const sorted = [...weights].sort((a,b)=>a.date.localeCompare(b.date)).slice(-12);
  if (!sorted.length) return <div className="empty-chart"><Weight size={34}/><p>{empty}</p></div>;
  const min = Math.min(...sorted.map(w=>w.kg))-1.5;
  const max = Math.max(...sorted.map(w=>w.kg))+1.5;
  const point = (w:WeightItem,i:number) => `${sorted.length===1?300:25+i*550/(sorted.length-1)},${155-((w.kg-min)/(max-min))*130}`;
  const points = sorted.map(point).join(" ");
  return <div className="weight-graph"><div className="weight-graph-stats"><strong>{formatNum(sorted[sorted.length-1].kg,locale,1)} <small>kg</small></strong><span>{calendarDisplay(sorted[sorted.length-1].date,locale,{day:"numeric",month:"short"})}</span></div>
    <svg viewBox="0 0 600 180" preserveAspectRatio="none" role="img" aria-label="Weight trend chart">
      <line x1="12" y1="155" x2="590" y2="155" stroke="#e9eae5" strokeDasharray="5 6"/><line x1="12" y1="90" x2="590" y2="90" stroke="#eef0eb" strokeDasharray="5 6"/><line x1="12" y1="25" x2="590" y2="25" stroke="#eef0eb" strokeDasharray="5 6"/>
      {sorted.length>1 && <><polygon points={`25,155 ${points} 575,155`} fill="#e9f2ea" opacity="0.8"/><polyline points={points} fill="none" stroke="#3f8064" strokeWidth="3.7" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/></>}
      {sorted.map((w,i)=>{const [x,y]=point(w,i).split(",").map(Number);return <circle key={w.id} cx={x} cy={y} r="5" fill="#3f8064" stroke="white" strokeWidth="2"/>;})}
    </svg><div className="weight-axis"><span>{calendarDisplay(sorted[0].date,locale,{day:"numeric",month:"short"})}</span><span>{calendarDisplay(sorted[sorted.length-1].date,locale,{day:"numeric",month:"short"})}</span></div></div>;
}

function DiaryView({locale,items,date,onDate,remove,navigate}:{locale:Locale;items:DiaryItem[];date:string;onDate:(d:string)=>void;remove:(id:string)=>void;navigate:(v:View)=>void}) {
  const t=translations[locale]; const sum=sumDiary(items);
  return <div className="view fade-in"><div className="view-header"><div><span className="eyebrow"><ClipboardList size={15}/> {t.navDiary.toUpperCase()}</span><h1>{t.diaryTitle}</h1><p>{t.diarySub}</p></div><button className="btn btn-primary" onClick={()=>navigate("scanner")}><Plus size={18}/>{t.addToDiary}</button></div>
    <div className="card diary-toolbar"><div className="date-controller"><button title={t.previous} onClick={()=>onDate(dayShift(date,-1))}><ChevronLeft size={20}/></button><div><CalendarDays size={18}/><span>{calendarDisplay(date,locale,{weekday:"long",month:"long",day:"numeric"})}</span></div><button title={t.next} onClick={()=>onDate(dayShift(date,1))} disabled={date>=todayDate()}><ChevronRight size={20}/></button></div>
      <input type="date" value={date} max={todayDate()} onChange={e=>e.target.value&&onDate(e.target.value)} aria-label={t.today}/></div>
    <div className="diary-summary"><div className="diary-kcal-summary"><span>{t.dayTotal}</span><strong>{formatNum(sum.kcal,locale)} <small>{t.kcal}</small></strong></div>
      {([[t.protein,sum.protein],[t.carbs,sum.carbs],[t.fat,sum.fat]] as [string,number][]).map(([label,value])=><div key={label}><span>{label}</span><strong>{formatNum(value,locale,1)} {t.grams}</strong></div>)}</div>
    <div className="card diary-list"><PanelHeading title={t.entries} subtitle={`${items.length} ${t.entries.toLowerCase()}`}/>
      {!items.length ? <div className="empty-diary"><div><ClipboardList size={35}/></div><h3>{t.diaryEmpty}</h3><p>{t.diaryEmptySub}</p><button className="btn btn-primary" onClick={()=>navigate("scanner")}><Plus size={18}/>{t.quickAdd}</button></div>
        : <div className="diary-items">{items.map(item=><div className="diary-item" key={item.id}>
          <div className="diary-item-img">{item.image?<img alt="" src={item.image} referrerPolicy="no-referrer"/>:<Leaf size={24}/>}</div>
          <div className="diary-item-name"><strong>{item.name}</strong><span>{formatNum(item.grams,locale)} {t.grams} · {item.source==="off"?"Open Food Facts":t.manual}</span></div>
          <div className="diary-item-cal"><strong>{formatNum(item.kcal,locale)} <small>{t.kcal}</small></strong><span>{t.protein}: {item.protein===null?"—":formatNum(item.protein,locale,1)}{t.grams}</span></div>
          <button className="icon-button trash" onClick={()=>void remove(item.id)} aria-label={t.remove} title={t.remove}><Trash2 size={17}/></button>
        </div>)}</div>}
    </div>
  </div>;
}

function ProfileView({locale,profile,plan,weights,onSave,onWeight,user,dbConfigured,openAuth,logout}:{
  locale:Locale; profile:Profile; plan:ReturnType<typeof calculatePlan>; weights:WeightItem[];
  onSave:(p:Profile)=>Promise<void>; onWeight:(date:string,kg:number)=>Promise<void>;
  user:SessionUser|null; dbConfigured:boolean; openAuth:(mode:"signup"|"login")=>void;logout:()=>Promise<void>;
}) {
  const t=translations[locale];
  const [draft,setDraft]=useState<Profile>(profile);
  const [weight,setWeight]=useState(String(profile.weightKg));
  const [weighDate,setWeighDate]=useState(todayDate);
  const [busy,setBusy]=useState(false);
  const [formError,setFormError]=useState("");
  useEffect(()=>{setDraft(profile);setWeight(String(profile.weightKg));},[profile]);
  const change = <K extends keyof Profile>(key:K,value:Profile[K]) => setDraft(prev=>({...prev,[key]:value}));
  const submit = async (e:React.FormEvent) => {
    e.preventDefault(); setFormError("");
    if (draft.goalWeightKg>draft.weightKg) {setFormError(t.goalRule);return;}
    setBusy(true);
    try {await onSave(draft);}catch(e){setFormError(e instanceof Error?e.message:t.formError);}finally{setBusy(false);}
  };
  const submitWeight = async (e:React.FormEvent) => {
    e.preventDefault(); setFormError("");setBusy(true);
    try {await onWeight(weighDate,Number(weight));}
    catch(e){setFormError(e instanceof Error?e.message:t.formError);}finally{setBusy(false);}
  };
  const activities = ["sedentary","light","moderate","active","very"] as const;
  const activityLabels = [t.activitySedentary,t.activityLight,t.activityModerate,t.activityActive,t.activityVery];
  return <div className="view fade-in"><div className="view-header"><div><span className="eyebrow"><Settings2 size={14}/> {t.planTitle.toUpperCase()}</span><h1>{t.settingsTitle}</h1><p>{t.settingsSub}</p></div><div className="profile-header-icon"><UserRound size={28}/></div></div>
    <div className="profile-grid"><section className="card profile-form-card"><PanelHeading title={t.personalDetails}/><form className="profile-form" onSubmit={e=>void submit(e)}>
      <div className="field"><label htmlFor="p-age">{t.age}</label><div className="field-with-suffix"><input id="p-age" type="number" required min="18" max="100" value={draft.age} onChange={e=>change("age",Number(e.target.value))}/><span>{t.years}</span></div></div>
      <div className="field"><label htmlFor="p-sex">{t.sex}</label><select id="p-sex" value={draft.sex} onChange={e=>change("sex",e.target.value as Profile["sex"])}><option value="female">{t.female}</option><option value="male">{t.male}</option></select></div>
      <div className="field"><label htmlFor="p-height">{t.height}</label><div className="field-with-suffix"><input id="p-height" type="number" required min="100" max="240" value={draft.heightCm} onChange={e=>change("heightCm",Number(e.target.value))}/><span>{t.cm}</span></div></div>
      <div className="field"><label htmlFor="p-weight">{t.currentWeight}</label><div className="field-with-suffix"><input id="p-weight" type="number" required min="30" max="400" step="0.1" value={draft.weightKg} onChange={e=>change("weightKg",Number(e.target.value))}/><span>{t.kg}</span></div></div>
      <div className="field"><label htmlFor="p-goal">{t.targetWeight}</label><div className="field-with-suffix"><input id="p-goal" type="number" required min="30" max="400" step="0.1" value={draft.goalWeightKg} onChange={e=>change("goalWeightKg",Number(e.target.value))}/><span>{t.kg}</span></div></div>
      <div className="field"><label htmlFor="p-rate">{t.weeklyTarget}</label><div className="field-with-suffix"><select id="p-rate" value={draft.weeklyGoalKg} onChange={e=>change("weeklyGoalKg",Number(e.target.value))}>
        {[0.2,0.3,0.4,0.5,0.6,0.75].map(n=><option key={n} value={n}>{n} {t.kg}</option>)}</select></div></div>
      <div className="field full"><label htmlFor="p-activity">{t.activity}</label><select id="p-activity" value={draft.activity} onChange={e=>change("activity",e.target.value as Profile["activity"])}>
        {activities.map((a,i)=><option value={a} key={a}>{activityLabels[i]}</option>)}</select></div>
      {formError && <p className="form-error">{formError}</p>}
      <button disabled={busy} type="submit" className="btn btn-primary profile-submit">{busy?<LoaderCircle size={17} className="spin"/>:<Check size={17}/>} {t.saveProfile}</button>
    </form></section>
    <div className="profile-side-col"><section className="card plan-detail"><PanelHeading title={t.planTitle} subtitle={t.planSub}/><div className="plan-main-number"><span>{t.dailyGoal}</span><strong>{formatNum(plan.suggestedCalories,locale)} <small>{t.kcal}</small></strong></div>
      <div className="plan-detail-grid"><div><span>{t.bmr}</span><strong>{formatNum(plan.bmr,locale)} {t.kcal}</strong></div><div><span>{t.maintenance}</span><strong>{formatNum(plan.maintenance,locale)} {t.kcal}</strong></div><div><span>{t.deficit}</span><strong>{formatNum(plan.deficit,locale)} {t.kcal}</strong></div><div><span>{t.weeklyLoss}</span><strong>≈ {plan.projectedWeeklyKg} {t.kg}</strong></div><div><span>{t.toGoal}</span><strong>{plan.weeks ?? "—"} {t.weeks}</strong></div><div><span>BMI</span><strong>{plan.bmi}</strong></div></div>
      {plan.floorApplied && <p className="soft-warning"><Info size={15}/>{t.floorNote}</p>}</section>
      <section className="card explainer"><div className="explainer-title"><CircleHelp size={19}/><strong>{t.methodology}</strong></div><p>{t.methodText}</p><div className="explainer-disclaimer"><ShieldCheck size={17}/><span>{t.disclaimer}</span></div></section></div>
    </div>
    <div className="profile-grid lower-profile"><section className="card weigh-form"><PanelHeading title={t.weightCheck} subtitle={t.weightCheckSub}/><form className="weigh-fields" onSubmit={e=>void submitWeight(e)}><div className="field"><label htmlFor="weigh-value">{t.currentWeight} ({t.kg})</label><input id="weigh-value" type="number" min="30" max="400" step="0.1" required value={weight} onChange={e=>setWeight(e.target.value)}/></div><div className="field"><label htmlFor="weigh-date">{t.today}</label><input id="weigh-date" type="date" max={todayDate()} required value={weighDate} onChange={e=>setWeighDate(e.target.value)}/></div><button disabled={busy} type="submit" className="btn btn-primary"><Plus size={17}/>{t.logWeight}</button></form>
      <div className="recent-weights"><h3>{t.weightHistory}</h3>{[...weights].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(w=><div key={w.id}><span>{calendarDisplay(w.date,locale,{day:"numeric",month:"short",year:"numeric"})}</span><strong>{w.kg} {t.kg}</strong></div>)}{!weights.length && <p className="muted">{t.noWeight}</p>}</div></section>
      <section className="card profile-account"><PanelHeading title={t.accountTitle} subtitle={t.accountSub}/><div className="account-display"><span className="account-avatar"><UserRound size={27}/></span><div><strong>{user?.name || t.demo}</strong><small>{user?.email || (dbConfigured ? t.demoNotice : t.dbMissing)}</small></div></div>
        {user ? <button className="btn btn-outline" onClick={()=>void logout()}><LogOut size={17}/>{t.logout}</button>:<div className="account-actions"><button className="btn btn-primary" onClick={()=>openAuth("signup")}><UserRound size={17}/>{t.signup}</button><button className="btn btn-outline" onClick={()=>openAuth("login")}><LogIn size={17}/>{t.login}</button></div>}</section>
    </div>
  </div>;
}

function AuthModal({mode,setMode,locale,dbConfigured,submit}:{mode:"signup"|"login";setMode:(v:"signup"|"login"|null)=>void;locale:Locale;dbConfigured:boolean;submit:(mode:"signup"|"login",input:{name:string;email:string;password:string})=>Promise<void>}) {
  const t=translations[locale];const [name,setName]=useState("");const [email,setEmail]=useState("");const [password,setPassword]=useState("");
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==="Escape")setMode(null);};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[setMode]);
  const onSubmit = async (e:React.FormEvent) => {e.preventDefault();setError("");setBusy(true);
    try {await submit(mode,{name,email,password});}catch(e){setError(e instanceof Error?e.message:t.genericError);}finally{setBusy(false);}};
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setMode(null);}}>
    <div className="auth-modal" role="dialog" aria-modal="true" aria-label={mode==="signup"?t.signupTitle:t.loginTitle}>
      <button className="modal-close" onClick={()=>setMode(null)} aria-label={t.close}><X size={20}/></button><span className="auth-logo">k<span>.</span></span>
      <h2>{mode==="signup"?t.signupTitle:t.loginTitle}</h2><p>{t.accountSub}</p>
      {!dbConfigured && <div className="auth-warning"><Info size={17}/>{t.dbMissing}</div>}
      <form onSubmit={e=>void onSubmit(e)} className="auth-form">{mode==="signup" && <div className="field"><label htmlFor="auth-name">{t.name}</label><input id="auth-name" value={name} minLength={2} maxLength={100} required onChange={e=>setName(e.target.value)}/></div>}
        <div className="field"><label htmlFor="auth-email">{t.email}</label><input id="auth-email" type="email" autoComplete="email" value={email} required onChange={e=>setEmail(e.target.value)}/></div>
        <div className="field"><label htmlFor="auth-password">{t.password}</label><input id="auth-password" type="password" autoComplete={mode==="signup"?"new-password":"current-password"} minLength={8} maxLength={72} value={password} required onChange={e=>setPassword(e.target.value)} placeholder={t.minPassword}/></div>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" disabled={busy||!dbConfigured} className="btn btn-primary auth-submit">{busy?<LoaderCircle className="spin" size={18}/>:<LogIn size={18}/>} {mode==="signup"?t.submitSignup:t.submitLogin}</button>
      </form><button className="switch-auth" onClick={()=>{setError("");setMode(mode==="signup"?"login":"signup");}}>{mode==="signup"?t.switchLogin:t.switchSignup}</button>
    </div>
  </div>;
}
