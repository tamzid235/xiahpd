import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Calendar, ClipboardList, Clock, FileText, Folder, Home, KeyRound, Lock, LogOut, Pencil, Save, Images, Trash2 } from "lucide-react";

/**
 * Mobile Inspection App
 * - Data: Create/Update project meta (address, scope) keyed by Project ID
 * - Inspection: Add dated entries (date, time, notes, multiple photos) per Project ID
 * - Report: View full timeline OR filter by a specific date for a Project ID
 *
 * Persistence strategy:
 * - Project metadata + inspection indexes are saved in localStorage (JSON)
 * - Full-resolution images are saved in IndexedDB (object store "photos") as Blobs
 *   and referenced by keys in the inspection entries. This allows larger storage than localStorage.
 * - Simple passcode gate stored as a hashed digest in localStorage for local-only access control.
 *
 * NOTE: Data persists in the same browser/device until the user clears site data.
 */

/*************************
 * Minimal IndexedDB helper
 *************************/
const DB_NAME = "mobile-inspection-app";
const DB_VERSION = 1;
const PHOTO_STORE = "photos";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        db.createObjectStore(PHOTO_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: Blob) {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key: string): Promise<Blob | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readonly");
    const req = tx.objectStore(PHOTO_STORE).get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}

/**********************
 * LocalStorage helpers
 **********************/
const LS_PROJECTS_KEY = "mia.projects:v1"; // Project metadata dictionary
const LS_INSPECTIONS_KEY = "mia.inspections:v1"; // Map: projectId -> InspectionEntry[]
const LS_PASSCODE_HASH = "mia.passcode.hash:v1"; // sha256 base64

export type ProjectMeta = {
  id: string; // Project ID
  address: string;
  scope: string;
  createdAt: number;
  updatedAt: number;
};

export type InspectionEntry = {
  id: string; // unique id
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  notes: string; // observations
  photoKeys: string[]; // keys in IndexedDB
  createdAt: number;
  updatedAt: number;
};

function loadProjects(): Record<string, ProjectMeta> {
  try {
    const raw = localStorage.getItem(LS_PROJECTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProjects(projects: Record<string, ProjectMeta>) {
  localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(projects));
}

function loadInspections(): Record<string, InspectionEntry[]> {
  try {
    const raw = localStorage.getItem(LS_INSPECTIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveInspections(map: Record<string, InspectionEntry[]>) {
  localStorage.setItem(LS_INSPECTIONS_KEY, JSON.stringify(map));
}

/****************
 * Security helpers
 ****************/
async function sha256Base64(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(hash);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/****************
 * UI Components
 ****************/
function Header({ title, onHome, onSignOut, authed }: { title: string; onHome?: () => void; onSignOut?: () => void; authed?: boolean }) {
  return (
    <div className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
      <div className="max-w-md mx-auto flex items-center gap-2 p-3">
        {onHome ? (
          <Button variant="ghost" size="icon" onClick={onHome} className="rounded-full">
            <Home className="h-5 w-5" />
          </Button>
        ) : null}
        <h1 className="text-lg font-semibold tracking-tight flex-1">{title}</h1>
        {authed && onSignOut ? (
          <Button variant="ghost" size="icon" onClick={onSignOut} className="rounded-full" title="Sign out">
            <LogOut className="h-5 w-5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function BigActionButton({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <Button onClick={onClick} className="w-full h-16 rounded-2xl text-base flex items-center justify-center gap-3 shadow-sm">
      <Icon className="h-5 w-5" />
      {label}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

/****************
 * Main App
 ****************/
export default function App() {
  const [view, setView] = useState<"auth" | "home" | "data" | "inspection" | "inspectionProject" | "report">("auth");
  const [projects, setProjects] = useState<Record<string, ProjectMeta>>(() => loadProjects());
  const [inspections, setInspections] = useState<Record<string, InspectionEntry[]>>(() => loadInspections());

  // Persist when state changes
  useEffect(() => saveProjects(projects), [projects]);
  useEffect(() => saveInspections(inspections), [inspections]);

  // Dialog states
  const [dataDialogOpen, setDataDialogOpen] = useState(false);
  const [inspectionDialogOpen, setInspectionDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);

  // Form states
  const [dataForm, setDataForm] = useState({ id: "", address: "", scope: "" });
  const [inspectionId, setInspectionId] = useState("");
  const [reportId, setReportId] = useState("");
  const [reportDate, setReportDate] = useState<string>(""); // optional report date

  // Selected project in inspection/report view
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState<string | null>(null); // active date filter for report

  // Inspection entry form (uncontrolled notes to prevent focus loss)
  const [entryDate, setEntryDate] = useState<string>("");
  const [entryTime, setEntryTime] = useState<string>("");
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const [entryPhotos, setEntryPhotos] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Image blob to object URL cache
  const [photoURLCache] = useState<Map<string, string>>(new Map());

  // Auth state
  const [hasPasscode, setHasPasscode] = useState<boolean>(() => !!localStorage.getItem(LS_PASSCODE_HASH));
  const [authed, setAuthed] = useState<boolean>(false);
  const [passcodeInput, setPasscodeInput] = useState<string>("");
  const [passcodeConfirm, setPasscodeConfirm] = useState<string>("");

  useEffect(() => {
    // Default date/time to now for convenience
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    setEntryDate(`${yyyy}-${mm}-${dd}`);
    setEntryTime(`${hh}:${min}`);
  }, []);

  useEffect(() => {
    setView("auth");
  }, []);

  function goHome() {
    setView("home");
    setActiveProjectId(null);
    setFilterDate(null);
  }

  /*************** Auth ***************/
  async function handleSetPasscode() {
    if (!passcodeInput || passcodeInput.length < 4) return toast.error("Choose a passcode (4+ chars)");
    if (passcodeInput !== passcodeConfirm) return toast.error("Passcodes do not match");
    const hash = await sha256Base64(passcodeInput);
    localStorage.setItem(LS_PASSCODE_HASH, hash);
    setHasPasscode(true);
    setAuthed(true);
    setView("home");
    toast.success("Passcode set");
  }

  async function handleSignIn() {
    if (!passcodeInput) return toast.error("Enter your passcode");
    const stored = localStorage.getItem(LS_PASSCODE_HASH);
    if (!stored) return toast.error("No passcode set. Set one first.");
    const hash = await sha256Base64(passcodeInput);
    if (hash !== stored) return toast.error("Incorrect passcode");
    setAuthed(true);
    setView("home");
    setPasscodeInput("");
    toast.success("Unlocked");
  }

  function handleSignOut() {
    setAuthed(false);
    setView("auth");
  }

  function AuthView() {
    return (
      <div className="min-h-screen bg-neutral-50">
        <Header title="Secure Access" />
        <div className="max-w-md mx-auto p-6 space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Lock className="h-4 w-4" /> {hasPasscode ? "Sign in" : "Set a passcode"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="pc">{hasPasscode ? "Passcode" : "Create passcode"}</Label>
                <Input id="pc" type="password" value={passcodeInput} onChange={(e) => setPasscodeInput(e.target.value)} placeholder={hasPasscode ? "Enter passcode" : "Choose a passcode"} />
              </div>
              {!hasPasscode && (
                <div className="space-y-1">
                  <Label htmlFor="pcc">Confirm passcode</Label>
                  <Input id="pcc" type="password" value={passcodeConfirm} onChange={(e) => setPasscodeConfirm(e.target.value)} placeholder="Re-enter passcode" />
                </div>
              )}
              {hasPasscode ? (
                <Button className="w-full h-12 rounded-xl" onClick={handleSignIn}><KeyRound className="h-4 w-4 mr-2" /> Unlock</Button>
              ) : (
                <Button className="w-full h-12 rounded-xl" onClick={handleSetPasscode}><Save className="h-4 w-4 mr-2" /> Save Passcode</Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  /*************** Data (Projects) ***************/
  function openDataPrompt() {
    setDataForm({ id: "", address: "", scope: "" });
    setDataDialogOpen(true);
  }

  function saveProject() {
    const id = dataForm.id.trim();
    if (!id) return toast.error("Please enter a Project ID.");
    const now = Date.now();
    const next: Record<string, ProjectMeta> = { ...projects };
    const prev = next[id];
    next[id] = {
      id,
      address: dataForm.address.trim(),
      scope: dataForm.scope.trim(),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    setProjects(next);
    toast.success(prev ? "Project updated." : "Project created.");
    setDataDialogOpen(false);
    setView("home");
  }

  /*************** Inspection ***************/
  function openInspectionPrompt() {
    setInspectionId("");
    setInspectionDialogOpen(true);
  }

  function proceedInspection() {
    const id = inspectionId.trim();
    if (!id) return toast.error("Enter a Project ID.");
    setActiveProjectId(id);
    setView("inspectionProject");
    setInspectionDialogOpen(false);
  }

  async function saveInspectionEntry() {
    if (!activeProjectId) return;
    if (!entryDate || !entryTime) return toast.error("Enter date and time.");

    const entryId = `${Date.now()}`;
    const photoKeys: string[] = [];

    // Save photos to IndexedDB
    for (let i = 0; i < entryPhotos.length; i++) {
      const file = entryPhotos[i];
      const key = `${activeProjectId}/inspections/${entryId}/photo-${i}`;
      await idbSet(key, file);
      photoKeys.push(key);
    }

    const notes = notesRef.current?.value?.trim() || "";

    const entry: InspectionEntry = {
      id: entryId,
      date: entryDate,
      time: entryTime,
      notes,
      photoKeys,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const next = { ...inspections };
    next[activeProjectId] = [...(next[activeProjectId] || []), entry].sort((a, b) => {
      const ta = new Date(`${a.date}T${a.time}:00`).getTime();
      const tb = new Date(`${b.date}T${b.time}:00`).getTime();
      return tb - ta; // newest first
    });

    setInspections(next);
    if (notesRef.current) notesRef.current.value = "";
    setEntryPhotos([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    toast.success("Inspection saved.");
  }

  async function photoURLFromKey(key: string): Promise<string> {
    if (photoURLCache.has(key)) return photoURLCache.get(key)!;
    const blob = await idbGet(key);
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    photoURLCache.set(key, url);
    return url;
  }

  function removePendingPhoto(index: number) {
    setEntryPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function ProjectHeader({ id }: { id: string }) {
    const meta = projects[id];
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Folder className="h-5 w-5" />
          <span className="font-semibold">Project {id}</span>
        </div>
        {meta ? (
          <div className="text-sm text-muted-foreground">
            <div><span className="font-medium">Address:</span> {meta.address || "—"}</div>
            <div><span className="font-medium">Scope:</span> {meta.scope || "—"}</div>
          </div>
        ) : (
          <div className="text-sm text-amber-600">No metadata found. Create it in <span className="font-medium">Data</span>.</div>
        )}
      </div>
    );
  }

  function InspectionForm() {
    return (
      <Section title="New Inspection Entry">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="date"><Calendar className="inline h-4 w-4 mr-1" /> Date</Label>
            <Input id="date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="time"><Clock className="inline h-4 w-4 mr-1" /> Time</Label>
            <Input id="time" type="time" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="notes"><ClipboardList className="inline h-4 w-4 mr-1" /> Observations</Label>
          {/* Uncontrolled textarea to avoid focus loss on re-renders */}
          <Textarea id="notes" ref={notesRef} rows={4} placeholder="Enter observations..." />
        </div>

        <div className="space-y-2">
          <Label htmlFor="photos"><Images className="inline h-4 w-4 mr-1" /> Photos</Label>
          <Input
            id="photos"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            ref={fileInputRef}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length === 0) return;
              setEntryPhotos((prev) => [...prev, ...files]);
            }}
          />
          {entryPhotos.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">{entryPhotos.length} file(s) selected.</div>
              <div className="grid grid-cols-4 gap-2">
                {entryPhotos.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="relative aspect-square w-full overflow-hidden rounded-xl bg-neutral-100">
                    <img src={URL.createObjectURL(f)} alt="preview" className="h-full w-full object-cover" />
                    <button type="button" onClick={() => removePendingPhoto(i)} className="absolute top-1 right-1 bg-white/80 rounded-full p-1 shadow" title="Remove">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <Button onClick={saveInspectionEntry} className="w-full h-12 rounded-xl"><Save className="h-4 w-4 mr-2" /> Save</Button>
      </Section>
    );
  }

  function InspectionList({ projectId, filterDate }: { projectId: string; filterDate?: string | null }) {
    let list = inspections[projectId] || [];
    if (filterDate) list = list.filter((e) => e.date === filterDate);

    if (list.length === 0) {
      return (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No inspections{filterDate ? ` on ${filterDate}` : ''}.</CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        {list.map((entry) => (
          <Card key={entry.id} className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>{entry.date}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>{entry.time}</span>
                  </div>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {entry.notes && (
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{entry.notes}</div>
              )}

              {entry.photoKeys.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {entry.photoKeys.map((k) => (
                    <AsyncImage key={k} idKey={k} photoURLFromKey={photoURLFromKey} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  function HomeView() {
    return (
      <div className="max-w-md mx-auto p-4 space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold tracking-tight">XiHPD</h1>
          <p className="text-sm text-muted-foreground">Mobile-friendly project data, inspections, and reports. Stored locally.</p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <BigActionButton icon={FileText} label="Data" onClick={() => { setView("data"); openDataPrompt(); }} />
          <BigActionButton icon={Pencil} label="Inspection" onClick={() => { setView("inspection"); openInspectionPrompt(); }} />
          <BigActionButton icon={ClipboardList} label="Report" onClick={() => { setView("report"); setReportDialogOpen(true); }} />
        </div>

        <Separator className="my-4" />

        <Section title="Recent Projects">
          {Object.keys(projects).length === 0 ? (
            <div className="text-sm text-muted-foreground">No projects yet. Tap <span className="font-medium">Data</span> to create one.</div>
          ) : (
            <div className="space-y-2">
              {Object.values(projects)
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, 5)
                .map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="truncate">
                      <span className="font-medium">{p.id}</span>
                      <span className="text-muted-foreground"> — {p.address || "(no address)"}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setActiveProjectId(p.id); setFilterDate(null); setView("inspectionProject"); }}>Open</Button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </Section>
      </div>
    );
  }

  if (!authed && view === "auth") return <AuthView />;

  return (
    <div className="min-h-screen bg-neutral-50">
      {view === "home" && <Header title="Home" authed={authed} onSignOut={handleSignOut} />}
      {view !== "home" && <Header title={view === "data" ? "Data" : view === "inspection" || view === "inspectionProject" ? "Inspection" : "Report"} onHome={goHome} authed={authed} onSignOut={handleSignOut} />}

      {view === "home" && <HomeView />}

      {/* Data Dialog */}
      <Dialog open={dataDialogOpen} onOpenChange={setDataDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Project Data</DialogTitle>
            <DialogDescription>Enter a Project ID and its details. If the ID exists, it will be updated.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pid">Project ID</Label>
              <Input id="pid" placeholder="e.g., 10234" value={dataForm.id} onChange={(e) => setDataForm({ ...dataForm, id: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="addr">Address</Label>
              <Input id="addr" placeholder="123 Main St, City, ST" value={dataForm.address} onChange={(e) => setDataForm({ ...dataForm, address: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="scope">Scope</Label>
              <Textarea id="scope" placeholder="Describe the scope..." value={dataForm.scope} onChange={(e) => setDataForm({ ...dataForm, scope: e.target.value })} />
            </div>
            <Button className="w-full h-12 rounded-xl" onClick={saveProject}><Save className="h-4 w-4 mr-2" /> Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Inspection Dialog */}
      <Dialog open={inspectionDialogOpen} onOpenChange={setInspectionDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Open Inspection</DialogTitle>
            <DialogDescription>Enter the Project ID to add or view inspections.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="inspid">Project ID</Label>
              <Input id="inspid" placeholder="e.g., 10234" value={inspectionId} onChange={(e) => setInspectionId(e.target.value)} />
            </div>
            <Button className="w-full h-12 rounded-xl" onClick={proceedInspection}><Pencil className="h-4 w-4 mr-2" /> Continue</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Report Dialog: supports ID-only or ID+Date */}
      <Dialog open={reportDialogOpen} onOpenChange={(open) => { setReportDialogOpen(open); if (!open) { setReportId(""); setReportDate(""); } }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Open Report</DialogTitle>
            <DialogDescription>View full timeline by ID, or filter by a specific date.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="repid">Project ID</Label>
              <Input id="repid" placeholder="e.g., 10234" value={reportId} onChange={(e) => setReportId(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="repdate">Date (optional)</Label>
              <Input id="repdate" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="h-12 rounded-xl"
                onClick={() => {
                  if (!reportId.trim()) return toast.error("Enter a Project ID.");
                  setActiveProjectId(reportId.trim());
                  setFilterDate(null);
                  setReportDialogOpen(false);
                  setView("inspectionProject");
                }}
              >
                <FileText className="h-4 w-4 mr-2" /> Full Timeline
              </Button>
              <Button
                className="h-12 rounded-xl"
                variant="outline"
                onClick={() => {
                  if (!reportId.trim()) return toast.error("Enter a Project ID.");
                  if (!reportDate) return toast.error("Pick a date.");
                  setActiveProjectId(reportId.trim());
                  setFilterDate(reportDate);
                  setReportDialogOpen(false);
                  setView("inspectionProject");
                }}
              >
                <Calendar className="h-4 w-4 mr-2" /> By Date
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Inspection Project View */}
      {view === "inspectionProject" && (
        <div className="max-w-md mx-auto p-4 space-y-4">
          <ProjectHeader id={activeProjectId || ""} />

          {filterDate && (
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2">
              <div className="text-sm">Filtered by date: <span className="font-medium">{filterDate}</span></div>
              <Button size="sm" variant="outline" onClick={() => setFilterDate(null)}>Clear</Button>
            </div>
          )}

          <InspectionForm />
          <Section title={filterDate ? `Timeline — ${filterDate}` : "Timeline"}>
            <InspectionList projectId={activeProjectId || ""} filterDate={filterDate} />
          </Section>
        </div>
      )}

      <div id="sonner" />
    </div>
  );
}

/**
 * Async image loader for photos stored in IndexedDB.
 */
function AsyncImage({ idKey, photoURLFromKey }: { idKey: string; photoURLFromKey: (k: string) => Promise<string> }) {
  const [url, setUrl] = useState<string>("");
  useEffect(() => {
    let active = true;
    (async () => {
      const u = await photoURLFromKey(idKey);
      if (active) setUrl(u);
    })();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [idKey]);
  return (
    <div className="aspect-square w-full overflow-hidden rounded-xl bg-neutral-100">
      {url ? (
        <img src={url} alt="inspection" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse" />
      )}
    </div>
  );
}