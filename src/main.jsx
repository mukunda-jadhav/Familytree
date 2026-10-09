import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  GitBranch,
  Users,
  Plus,
  Search,
  Share2,
  Printer,
  Leaf,
  X,
  ArrowRight,
  Minus,
  Maximize,
  MapPin,
  Calendar,
  ShieldCheck,
  LogOut,
  Trash2,
  Link,
  Check,
} from "lucide-react";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { auth, configured, api } from "./firebase";
import { example } from "./data";
import { layout } from "./layout";
import "./style.css";
const blank = () => ({
  id: crypto.randomUUID(),
  name: "",
  birth: "",
  place: "",
  bio: "",
  gender: "other",
  deceased: false,
});
function Modal({ title, close, children, message }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog ref={ref} onCancel={close}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button aria-label="Close" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {message && (
        <div className="notice" role="alert">
          {message}
        </div>
      )}
      {children}
    </dialog>
  );
}
function App() {
  const shared = new URLSearchParams(location.search).get("share");
  const [tree, setTree] = useState(() => {
    if (shared) return { name: "Shared family tree", people: [], edges: [] };
    try {
      return JSON.parse(localStorage.getItem("kinfolk-demo")) || example;
    } catch {
      return example;
    }
  });
  const [selected, select] = useState(null),
    [modal, setModal] = useState(null),
    [person, setPerson] = useState(blank),
    [relation, setRelation] = useState({
      relative: "",
      type: "blood",
      direction: "child",
    }),
    [query, setQuery] = useState(""),
    [view, setView] = useState("tree"),
    [zoom, setZoom] = useState(1),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [user, setUser] = useState(null),
    [verified, setVerified] = useState(false),
    [trees, setTrees] = useState([]),
    [record, setRecord] = useState(null),
    [dirty, setDirty] = useState(false),
    [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [email, setEmail] = useState(""),
    [step, setStep] = useState("phone"),
    [shareUrl, setShareUrl] = useState("");
  const confirmation = useRef(null),
    recaptcha = useRef(null);
  const [drawing, setDrawing] = useState(null);
  const [layoutError, setLayoutError] = useState("");
  const {
    positions = {},
    paths = [],
    width = 900,
    height = 600,
    generations = 0,
  } = drawing || {};
  const layoutReady =
    drawing?.people === tree.people && drawing?.edges === tree.edges;
  useEffect(() => {
    let cancelled = false;
    setLayoutError("");
    layout(tree)
      .then((result) => {
        if (!cancelled)
          setDrawing({ ...result, people: tree.people, edges: tree.edges });
      })
      .catch(() => {
        if (!cancelled)
          setLayoutError(
            "Could not arrange this tree. Try People view while you check its relationships.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [tree.people, tree.edges]);
  const current = tree.people.find((p) => p.id === selected);
  const readOnly = Boolean(shared);
  useEffect(() => {
    if (shared)
      api("/shared/" + shared)
        .then(setTree)
        .catch((e) => setMessage(e.message));
  }, []);
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        setStep("email");
        try {
          const me = await api("/me");
          setVerified(me.verified);
          if (me.verified) {
            setStep("done");
            setTrees(await api("/trees"));
          }
        } catch (e) {
          setMessage(e.message);
        }
      } else {
        setVerified(false);
        setRecord(null);
        setTrees([]);
        setStep("phone");
      }
    });
  }, []);
  useEffect(() => {
    if (!record && !shared && !user)
      localStorage.setItem("kinfolk-demo", JSON.stringify(tree));
  }, [tree, record, user]);
  async function run(fn) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  function change(t) {
    setTree(t);
    setDirty(true);
  }
  function edit(p) {
    setPerson(p ? { ...p } : blank());
    setRelation({
      relative: selected || "",
      type: "blood",
      direction: "child",
    });
    setModal("person");
  }
  function savePerson(e) {
    e.preventDefault();
    if (!person.name.trim()) {
      setMessage("Please enter a name.");
      return;
    }
    const exists = tree.people.some((p) => p.id === person.id);
    let edges = tree.edges;
    if (!exists && relation.relative) {
      const [from, to] =
        relation.direction === "parent"
          ? [person.id, relation.relative]
          : [relation.relative, person.id];
      edges = [
        ...edges,
        { id: crypto.randomUUID(), from, to, type: relation.type },
      ];
    }
    change({
      ...tree,
      people: exists
        ? tree.people.map((p) => (p.id === person.id ? person : p))
        : [...tree.people, person],
      edges,
    });
    select(person.id);
    setModal(null);
  }
  async function save() {
    if (!verified) {
      setModal("auth");
      return;
    }
    const result = record
      ? await api("/trees/" + record.id, "PUT", {
          ...tree,
          version: record.version,
        })
      : await api("/trees", "POST", tree);
    setRecord({ ...record, ...result });
    setDirty(false);
    setTrees(await api("/trees"));
    setMessage("Your family tree is saved.");
    return { ...record, ...result };
  }
  function switchTree(id) {
    if (dirty && !confirm("Discard unsaved changes and open another tree?"))
      return;
    const t = trees.find((t) => t.id === id);
    if (t) {
      setTree(t.data);
      setRecord(t);
      setDirty(false);
      select(null);
    }
  }
  async function sendPhone() {
    if (!configured)
      throw Error(
        "Firebase is not configured yet. Follow the project README to enable verification.",
      );
    recaptcha.current?.clear();
    recaptcha.current = new RecaptchaVerifier(auth, "recaptcha", {
      size: "normal",
    });
    confirmation.current = await signInWithPhoneNumber(
      auth,
      phone,
      recaptcha.current,
    );
    setStep("sms");
    setCode("");
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <GitBranch />
          </span>
          kinfolk<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR FAMILY SPACE</div>
        <button
          className={"nav " + (view === "tree" ? "active" : "")}
          onClick={() => setView("tree")}
        >
          <GitBranch size={18} /> Family tree
        </button>
        <button
          className={"nav " + (view === "people" ? "active" : "")}
          onClick={() => setView("people")}
        >
          <Users size={18} /> Family members{" "}
          <span className="count">{tree.people.length}</span>
        </button>
        <div className="sidebar-note">
          <Leaf size={26} />
          <h3>
            A little closer.
            <br />
            Across generations.
          </h3>
          <p>Keep the people, connections, and stories that make you, you.</p>
        </div>
        <div className="account">
          <span className="avatar small">{user ? "K" : "G"}</span>
          <div>
            <strong>{user ? "Your account" : "Guest workspace"}</strong>
            <small>
              {shared
                ? "Shared · view only"
                : verified
                  ? "Phone & email verified"
                  : "Explore the demo"}
            </small>
          </div>
          {user ? (
            <button
              aria-label="Sign out"
              onClick={() =>
                run(async () => {
                  await signOut(auth);
                  setTree(example);
                  setDirty(false);
                })
              }
            >
              <LogOut size={17} />
            </button>
          ) : (
            <button
              aria-label="Create account"
              onClick={() => setModal("auth")}
            >
              <ArrowRight size={18} />
            </button>
          )}
        </div>
      </aside>
      <main>
        <header>
          <span>
            My workspace <span className="slash">/</span> Family tree
          </span>
          <div className="header-right">
            <span className="privacy">
              <ShieldCheck size={15} />
              {shared
                ? "Shared view"
                : record
                  ? "Private workspace"
                  : "Local demo"}
            </span>
            {!shared && (
              <button onClick={() => setModal("auth")}>
                {verified ? "Verified account" : "Create your account"}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </header>
        <section className="intro">
          <div>
            <div className="eyebrow">OUR ROOTS. OUR PEOPLE. OUR STORY.</div>
            <h1>{tree.name}</h1>
            <p>Every connection tells a story. Let yours grow.</p>
          </div>
          <div className="actions">
            <button
              disabled={view === "tree" && !layoutReady}
              onClick={() => window.print()}
            >
              <Printer size={17} /> Print / PDF
            </button>
            {!shared && (
              <>
                <button
                  onClick={() => {
                    setShareUrl("");
                    setModal("share");
                  }}
                >
                  <Share2 size={17} /> Share tree
                </button>
                <button className="primary" onClick={() => edit()}>
                  <Plus size={18} /> Add person
                </button>
              </>
            )}
          </div>
        </section>
        <div className="stats">
          <div>
            <span className="stat-icon">
              <Users size={20} />
            </span>
            <strong>{tree.people.length}</strong>
            <span>Family members</span>
          </div>
          <div>
            <span className="stat-icon">
              <GitBranch size={20} />
            </span>
            <strong>{generations}</strong>
            <span>Generations</span>
          </div>
          <div>
            <span className="stat-icon">
              <Link size={20} />
            </span>
            <strong>{tree.edges.length}</strong>
            <span>Connections</span>
          </div>
          <div className="stat-note">
            <span className="status-dot" />
            {shared
              ? "Read-only family link"
              : record
                ? dirty
                  ? "Unsaved changes"
                  : "Saved to your account"
                : "Demo · saved on this browser"}
          </div>
        </div>
        {message && (
          <div className="notice" role="status">
            {message}
            <button onClick={() => setMessage("")} aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        )}
        <section className="tree-panel">
          <div className="toolbar">
            <div className="tabs">
              <button
                className={view === "tree" ? "chosen" : ""}
                onClick={() => setView("tree")}
              >
                <GitBranch size={16} /> Tree view
              </button>
              <button
                className={view === "people" ? "chosen" : ""}
                onClick={() => setView("people")}
              >
                <Users size={16} /> People
              </button>
            </div>
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Find a family member"
                placeholder="Find a family member…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {!shared && (
              <button onClick={() => setModal("manage")}>Manage tree</button>
            )}
          </div>
          <div className="canvas" style={{ minHeight: 620 }}>
            {tree.people.length === 0 ? (
              <div className="empty">
                <GitBranch size={44} />
                <h2>Your story starts with one person.</h2>
                <p>
                  Add yourself, then connect your parents, children, and
                  relatives.
                </p>
                {!shared && (
                  <button className="primary" onClick={() => edit()}>
                    Add the first person
                  </button>
                )}
              </div>
            ) : view === "tree" && !layoutReady ? (
              <div className="empty" role="status">
                {layoutError || "Arranging family branches…"}
              </div>
            ) : view === "tree" ? (
              <div className="tree-scroll">
                <div
                  className="graph"
                  style={{ width: width * zoom, height: height * zoom }}
                >
                  <div
                    style={{
                      width,
                      height,
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                      position: "relative",
                    }}
                  >
                    <svg
                      className="connections"
                      width={width}
                      height={height}
                      aria-label="Family relationships"
                    >
                      {paths.map((path) => {
                        const active =
                          selected && path.members.includes(selected);
                        const muted = selected && !active;
                        return (
                          <g
                            key={path.id}
                            className={
                              "family-connection " +
                              (active ? "highlighted " : "") +
                              (muted ? "muted" : "")
                            }
                          >
                            <path className="connection-halo" d={path.d} />
                            <path
                              className={"connection-line " + path.type}
                              d={path.d}
                            />
                            {path.junctions?.map((point, index) => (
                              <circle
                                key={index}
                                className={"family-junction " + path.type}
                                cx={point.x}
                                cy={point.y}
                                r="3"
                              />
                            ))}
                          </g>
                        );
                      })}
                    </svg>
                    {tree.people.map((p) => (
                      <button
                        key={p.id}
                        className={
                          "person-card " +
                          (p.id === selected ? "selected " : "") +
                          (!p.name.toLowerCase().includes(query.toLowerCase())
                            ? "dim"
                            : "")
                        }
                        style={{
                          left: positions[p.id].x,
                          top: positions[p.id].y,
                        }}
                        onClick={() => select(selected === p.id ? null : p.id)}
                      >
                        <span className={"avatar " + p.gender}>
                          {p.name
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.birth
                            ? new Date(p.birth + "T00:00:00").getFullYear()
                            : "Birth year unknown"}
                          {p.deceased ? " · In memory" : ""}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="people-list">
                {tree.people
                  .filter((p) =>
                    p.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((p) => (
                    <button key={p.id} onClick={() => select(p.id)}>
                      <span className={"avatar " + p.gender}>
                        {p.name.charAt(0)}
                      </span>
                      <div>
                        <strong>{p.name}</strong>
                        <small>{p.place || "Location not added"}</small>
                      </div>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                {!tree.people.some((p) =>
                  p.name.toLowerCase().includes(query.toLowerCase()),
                ) && <p>No matching family members.</p>}
              </div>
            )}
            <div className="canvas-bottom">
              <div className="legend">
                <span>
                  <i /> Blood relation
                </span>
                <span>
                  <i className="partner" /> Partner
                </span>
                <span>
                  <i className="adoptive" /> Adoptive
                </span>
              </div>
              {view === "tree" && (
                <div className="zoom">
                  <button
                    aria-label="Zoom out"
                    onClick={() => setZoom(Math.max(0.3, zoom - 0.1))}
                  >
                    <Minus size={16} />
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button
                    aria-label="Zoom in"
                    onClick={() => setZoom(Math.min(1.5, zoom + 0.1))}
                  >
                    <Plus size={16} />
                  </button>
                  <button aria-label="Reset zoom" onClick={() => setZoom(1)}>
                    <Maximize size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
        <footer>
          <Leaf size={15} /> A family is more than a tree. It’s a collection of
          stories.<span>Made for the generations to come.</span>
        </footer>
      </main>
      {current && (
        <aside className="details">
          <button
            className="close-details"
            onClick={() => select(null)}
            aria-label="Close person details"
          >
            <X />
          </button>
          <span className={"avatar large " + current.gender}>
            {current.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </span>
          <div className="eyebrow">FAMILY MEMBER</div>
          <h2>{current.name}</h2>
          <p>
            <Calendar size={16} />
            {current.birth || "Birthday not added"}
          </p>
          <p>
            <MapPin size={16} />
            {current.place || "Location not added"}
          </p>
          <h3>Their story</h3>
          <p className="bio">{current.bio || "A story waiting to be told."}</p>
          <h3>Connections</h3>
          {tree.edges
            .filter((e) => e.from === current.id || e.to === current.id)
            .map((e) => (
              <div className="relative" key={e.id}>
                <span>
                  {
                    tree.people.find(
                      (p) => p.id === (e.from === current.id ? e.to : e.from),
                    )?.name
                  }
                </span>
                <small>
                  {e.type === "partner"
                    ? "Partner"
                    : (e.from === current.id ? "Child" : "Parent") +
                      (e.type === "adoptive" ? " (adoptive)" : "")}
                </small>
                {!shared && (
                  <button
                    aria-label="Remove relationship"
                    onClick={() => {
                      if (confirm("Remove this connection?"))
                        change({
                          ...tree,
                          edges: tree.edges.filter((x) => x.id !== e.id),
                        });
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          {!shared && (
            <div className="detail-actions">
              <button className="primary" onClick={() => edit(current)}>
                Edit person
              </button>
              <button onClick={() => edit()}>Add a relative</button>
              <button
                onClick={() => {
                  setRelation({
                    relative: "",
                    type: "blood",
                    direction: "child",
                  });
                  setModal("connect");
                }}
              >
                Connect existing person
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm("Delete this person and their connections?")) {
                    change({
                      ...tree,
                      people: tree.people.filter((p) => p.id !== current.id),
                      edges: tree.edges.filter(
                        (e) => e.from !== current.id && e.to !== current.id,
                      ),
                    });
                    select(null);
                  }
                }}
              >
                <Trash2 size={16} /> Remove person
              </button>
            </div>
          )}
        </aside>
      )}
      {modal === "person" && (
        <Modal
          message={message}
          title={
            tree.people.some((p) => p.id === person.id)
              ? "Edit their story"
              : "A new branch of the family"
          }
          close={() => setModal(null)}
        >
          <form onSubmit={savePerson}>
            <label>
              Full name
              <input
                autoFocus
                required
                maxLength={100}
                value={person.name}
                onChange={(e) => setPerson({ ...person, name: e.target.value })}
              />
            </label>
            <div className="form-row">
              <label>
                Date of birth
                <input
                  type="date"
                  value={person.birth}
                  onChange={(e) =>
                    setPerson({ ...person, birth: e.target.value })
                  }
                />
              </label>
              <label>
                Gender
                <select
                  value={person.gender}
                  onChange={(e) =>
                    setPerson({ ...person, gender: e.target.value })
                  }
                >
                  <option value="other">Not specified / other</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </label>
            </div>
            <label>
              Hometown
              <input
                maxLength={120}
                value={person.place}
                onChange={(e) =>
                  setPerson({ ...person, place: e.target.value })
                }
              />
            </label>
            <label>
              Their story
              <textarea
                rows={3}
                maxLength={2000}
                value={person.bio}
                onChange={(e) => setPerson({ ...person, bio: e.target.value })}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={person.deceased}
                onChange={(e) =>
                  setPerson({ ...person, deceased: e.target.checked })
                }
              />{" "}
              In loving memory (deceased)
            </label>
            {!tree.people.some((p) => p.id === person.id) && (
              <Relationship
                tree={tree}
                relation={relation}
                setRelation={setRelation}
              />
            )}
            <button className="primary full">Save person</button>
          </form>
        </Modal>
      )}
      {modal === "connect" && (
        <Modal
          message={message}
          title={"Connect to " + current?.name}
          close={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const from =
                  relation.direction === "parent"
                    ? relation.relative
                    : selected,
                to =
                  relation.direction === "parent"
                    ? selected
                    : relation.relative;
              if (!from || !to) return;
              const edges = [
                ...tree.edges,
                { id: crypto.randomUUID(), from, to, type: relation.type },
              ];
              function reaches(id, target, visited = new Set()) {
                if (id === target) return true;
                if (visited.has(id)) return false;
                visited.add(id);
                return tree.edges
                  .filter((x) => x.type !== "partner" && x.from === id)
                  .some((x) => reaches(x.to, target, visited));
              }
              if (
                tree.edges.some(
                  (x) =>
                    (x.from === from && x.to === to) ||
                    (relation.type === "partner" &&
                      x.from === to &&
                      x.to === from),
                )
              ) {
                setMessage("These people are already connected.");
                return;
              }
              if (relation.type !== "partner" && reaches(to, from)) {
                setMessage("This would create an ancestry loop.");
                return;
              }
              change({ ...tree, edges });
              setModal(null);
            }}
          >
            <Relationship
              tree={{
                ...tree,
                people: tree.people.filter((p) => p.id !== selected),
              }}
              relation={relation}
              setRelation={setRelation}
              existing
            />
            <button className="primary full">Connect people</button>
          </form>
        </Modal>
      )}
      {modal === "manage" && (
        <Modal
          message={message}
          title="Your family trees"
          close={() => setModal(null)}
        >
          <label>
            Tree name
            <input
              maxLength={100}
              value={tree.name}
              onChange={(e) => change({ ...tree, name: e.target.value })}
            />
          </label>
          <button
            className="primary full"
            disabled={busy || !tree.name.trim()}
            onClick={() => run(save)}
          >
            {verified
              ? "Save tree to account"
              : "Verify account to save online"}
          </button>
          {trees.length > 0 && (
            <label>
              Open a saved tree
              <select
                value={record?.id || ""}
                onChange={(e) => {
                  switchTree(e.target.value);
                  setModal(null);
                }}
              >
                <option value="">Choose a tree</option>
                {trees.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="full"
            onClick={() => {
              if (
                dirty &&
                !confirm("Discard unsaved changes and start a new tree?")
              )
                return;
              setRecord(null);
              change({ name: "My family", people: [], edges: [] });
              select(null);
              setModal(null);
            }}
          >
            Start a new family tree
          </button>
        </Modal>
      )}
      {modal === "share" && (
        <Modal
          message={message}
          title="Bring the family together"
          close={() => setModal(null)}
        >
          <p>
            Create a view-only link. Anyone with the link can see names,
            birthdays, places, and stories in this tree. Your account email and
            phone stay private.
          </p>
          {shareUrl ? (
            <>
              <label>
                Shareable link
                <input readOnly value={shareUrl} />
              </label>
              <button
                className="primary full"
                onClick={() =>
                  run(async () => {
                    await navigator.clipboard.writeText(shareUrl);
                    setMessage("Link copied.");
                  })
                }
              >
                Copy link
              </button>
            </>
          ) : (
            <button
              className="primary full"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!verified) {
                    setModal("auth");
                    return;
                  }
                  const r = await save();
                  const result = await api("/trees/" + r.id + "/share", "POST");
                  setShareUrl(result.url);
                })
              }
            >
              Save and create link
            </button>
          )}
          {record && (
            <button
              className="full"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/trees/" + record.id + "/share", "DELETE");
                  setShareUrl("");
                  setMessage(
                    "Sharing disabled. Existing links no longer work.",
                  );
                })
              }
            >
              Disable shared link
            </button>
          )}
          <small>Creating a new link replaces the previous one.</small>
        </Modal>
      )}
      {modal === "auth" && (
        <Modal
          message={message}
          title={
            verified ? "You’re all set" : "Make room for your whole family"
          }
          close={() => {
            recaptcha.current?.clear();
            setModal(null);
          }}
        >
          <p>
            Verify your mobile number and email to save your trees and share
            them with family.
          </p>
          {!configured && (
            <div className="setup-note">
              Preview mode: connect Firebase, PostgreSQL, and SMTP using the
              README to enable real verification.
            </div>
          )}
          {verified ? (
            <>
              <p>
                <Check /> Phone and email verified.
              </p>
              <button
                className="primary full"
                onClick={() => setModal("manage")}
              >
                Continue to your trees
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  if (step === "phone") await sendPhone();
                  else if (step === "sms") {
                    await confirmation.current.confirm(code);
                    setStep("email");
                    setCode("");
                  } else if (step === "email") {
                    await api("/email/send", "POST", { email });
                    setStep("email-code");
                    setCode("");
                  } else {
                    await api("/email/verify", "POST", { code });
                    setVerified(true);
                    setTrees(await api("/trees"));
                    setStep("done");
                  }
                });
              }}
            >
              {step === "phone" && (
                <>
                  <label>
                    Mobile number
                    <input
                      type="tel"
                      autoComplete="tel"
                      placeholder="+91 98765 43210"
                      pattern="\+[1-9][0-9]{7,14}"
                      required
                      value={phone}
                      onChange={(e) =>
                        setPhone(e.target.value.replace(/\s/g, ""))
                      }
                    />
                  </label>
                  <p className="fine">
                    By continuing, you agree to receive a verification SMS.
                    Google processes your number for authentication and abuse
                    prevention.
                  </p>
                </>
              )}
              {step === "email" && (
                <label>
                  Email address
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              )}
              {(step === "sms" || step === "email-code") && (
                <label>
                  {step === "sms"
                    ? "SMS verification code"
                    : "Email verification code"}
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
              )}
              <div id="recaptcha" />
              <button className="primary full" disabled={busy || !configured}>
                {busy
                  ? "Please wait…"
                  : step === "phone"
                    ? "Send SMS code"
                    : step === "email"
                      ? "Send email code"
                      : "Verify code"}
              </button>
              {(step === "sms" || step === "email-code") && (
                <button
                  type="button"
                  className="full"
                  onClick={() => {
                    setStep(step === "sms" ? "phone" : "email");
                    setCode("");
                  }}
                >
                  Change details / resend code
                </button>
              )}
            </form>
          )}
        </Modal>
      )}
      {busy && (
        <div className="busy" role="status">
          Working…
        </div>
      )}
      {modal && message && (
        <div className="modal-notice" role="alert">
          {message}
        </div>
      )}
    </div>
  );
}
function Relationship({ tree, relation, setRelation, existing = false }) {
  return (
    <>
      <label>
        {existing ? "Person to connect" : "Connect to a family member"}
        <select
          required={existing}
          value={relation.relative}
          onChange={(e) =>
            setRelation({ ...relation, relative: e.target.value })
          }
        >
          <option value="">
            {existing ? "Choose a person" : "No connection yet"}
          </option>
          {tree.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {relation.relative && (
        <div className="form-row">
          <label>
            Relationship
            <select
              value={relation.type}
              onChange={(e) =>
                setRelation({ ...relation, type: e.target.value })
              }
            >
              <option value="blood">Blood relation</option>
              <option value="partner">Partner / spouse</option>
              <option value="adoptive">Adoptive</option>
            </select>
          </label>
          {relation.type !== "partner" && (
            <label>
              {existing
                ? "Person to connect is their…"
                : "New person is their…"}
              <select
                value={relation.direction}
                onChange={(e) =>
                  setRelation({ ...relation, direction: e.target.value })
                }
              >
                <option value="child">Child</option>
                <option value="parent">Parent</option>
              </select>
            </label>
          )}
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
