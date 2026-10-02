import { useEffect, useRef, useState } from "react";
import {
  ShoppingBag,
  ArrowRight,
  Headphones,
  Keyboard,
  Mouse,
  Backpack,
  NotebookPen,
  Speaker,
  Lamp,
  BottleWine,
  Package,
  ShieldCheck,
  Truck,
  LogOut,
  Search,
  Plus,
  Minus,
  RefreshCw,
  X,
  CheckCircle2,
  Bell,
  type LucideIcon,
} from "lucide-react";
import {
  api,
  money,
  setCsrf,
  cartSubtotal,
  User,
  Product,
  Order,
  Page,
  SessionResponse,
  PaymentMethods,
  Notification,
  Overview,
} from "./api";
import "./index.css";
type Screen = "store" | "orders" | "operations" | "notifications";
const categoryIcons: Record<string, LucideIcon> = {
  Audio: Headphones,
  Workspace: Keyboard,
  Travel: Backpack,
  Essentials: NotebookPen,
};
function ProductArt({ p }: { p: Product }) {
  const Icon = p.sku.includes("HD")
    ? Headphones
    : p.sku.includes("LP")
      ? Lamp
      : p.sku.includes("BT")
        ? BottleWine
        : p.sku.includes("MS")
          ? Mouse
          : p.sku.includes("SP")
            ? Speaker
            : (categoryIcons[p.category] ?? Package);
  return (
    <div className={"product-art " + p.category.toLowerCase()}>
      <span className="art-orbit" />
      <Icon size={88} strokeWidth={1.1} />
      <span className="art-caption">
        COMMERCEFLOW / {p.category.toUpperCase()}
      </span>
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status.toLowerCase()}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
function Login({
  close,
  done,
}: {
  close: () => void;
  done: (u: User) => void;
}) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      email = String(f.get("email")),
      password = String(f.get("password"));
    try {
      if (register)
        await api("/auth/register", {
          email,
          password,
          name: String(f.get("name")),
        });
      const r = await api<{ user: User; csrf: string }>("/auth/login", {
        email,
        password,
      });
      setCsrf(r.csrf);
      done(r.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Account access"
      >
        <button
          className="icon-button modal-close"
          onClick={close}
          aria-label="Close"
        >
          <X />
        </button>
        <div className="brand-mark">
          <ShoppingBag size={24} />
        </div>
        <h2>{register ? "Create your account" : "Welcome back"}</h2>
        <p>Access your orders and a thoughtful shopping experience.</p>
        <form onSubmit={submit}>
          {register && (
            <label>
              Full name
              <input name="name" required minLength={2} maxLength={80} />
            </label>
          )}
          <label>
            Email address
            <input name="email" type="email" required maxLength={254} />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Please wait..." : register ? "Create account" : "Sign in"}
            <ArrowRight size={16} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
        <p className="hint">
          Demo emails: customer / staff / admin @commerceflow.example. Password:
          your local DEMO_PASSWORD.
        </p>
      </section>
    </div>
  );
}
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [screen, setScreen] = useState<Screen>("store"),
    [login, setLogin] = useState(false),
    [products, setProducts] = useState<Product[]>([]),
    [categories, setCategories] = useState<string[]>([]),
    [category, setCategory] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [cart, setCart] = useState<Record<string, number>>({}),
    [cartProducts, setCartProducts] = useState<Record<string, Product>>({}),
    [cartOpen, setCartOpen] = useState(false),
    [orders, setOrders] = useState<Order[]>([]),
    [orderPage, setOrderPage] = useState(1),
    [orderTotal, setOrderTotal] = useState(0),
    [selected, setSelected] = useState<Order | null>(null),
    [overview, setOverview] = useState<Overview | null>(null),
    [notifications, setNotifications] = useState<Notification[]>([]),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [methods, setMethods] = useState<PaymentMethods>({
      sandbox: true,
      stripe: false,
      bkash: false,
    }),
    [now, setNow] = useState(Date.now());
  const intent = useRef<{ payload: string; key: string } | null>(null);
  const subtotal = cartSubtotal(Object.values(cartProducts), cart),
    count = Object.values(cart).reduce((a, b) => a + b, 0);
  useEffect(() => {
    api<SessionResponse>("/auth/me")
      .then((r) => {
        setUser(r.user);
        setCsrf(r.csrf);
        if (new URLSearchParams(window.location.search).has("payment")) {
          setScreen("orders");
          setMessage("Check your order for verified payment status.");
        }
      })
      .catch(() => {});
    api<PaymentMethods>("/payments/methods")
      .then(setMethods)
      .catch(() => {});
    api<string[]>("/catalog/categories")
      .then(setCategories)
      .catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api<Page<Product>>(
        `/catalog/products?page=${page}&limit=12&search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}`,
      )
        .then((r) => {
          if (alive) {
            setProducts(r.items);
            setTotal(r.total);
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [page, search, category]);
  async function refreshOrders() {
    if (!user) return;
    const r = await api<Page<Order>>(`/orders?page=${orderPage}&limit=10`);
    setOrders(r.items);
    setOrderTotal(r.total);
    if (selected) setSelected(await api<Order>("/orders/" + selected.id));
  }
  async function refreshOverview() {
    setOverview(await api<Overview>("/admin/overview?limit=50"));
  }
  useEffect(() => {
    if (!user) return;
    let alive = true;
    async function load() {
      try {
        if (screen === "orders" || screen === "operations") {
          const r = await api<Page<Order>>(
            `/orders?page=${orderPage}&limit=10`,
          );
          if (alive) {
            setOrders(r.items);
            setOrderTotal(r.total);
          }
        }
        if (screen === "operations" && user?.role === "ADMIN") {
          const r = await api<Overview>("/admin/overview?limit=50");
          if (alive) setOverview(r);
        }
        if (screen === "notifications") {
          const r = await api<Notification[]>("/notifications");
          if (alive) setNotifications(r);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [screen, user, orderPage]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function add(p: Product) {
    setCartProducts((old) => ({ ...old, [p.id]: p }));
    setCart((old) => ({
      ...old,
      [p.id]: Math.min(10, p.available, (old[p.id] ?? 0) + 1),
    }));
    setCartOpen(true);
  }
  async function checkout(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) {
      setLogin(true);
      return;
    }
    const form = new FormData(e.currentTarget),
      body = {
        items: Object.entries(cart)
          .filter(([, q]) => q > 0)
          .map(([productId, quantity]) => ({ productId, quantity })),
        address: {
          name: String(form.get("name")),
          phone: String(form.get("phone")),
          street: String(form.get("street")),
          city: String(form.get("city")),
        },
        ...(form.get("coupon")
          ? { coupon: String(form.get("coupon")).trim() }
          : {}),
      };
    const payload = JSON.stringify(body);
    if (intent.current?.payload !== payload)
      intent.current = { payload, key: crypto.randomUUID() };
    await action(async () => {
      const o = await api<Order>("/orders", body, "POST", intent.current!.key);
      setSelected(o);
      setCart({});
      intent.current = null;
      setCartOpen(false);
      setScreen("orders");
      setMessage("Stock reserved. Complete payment before your hold expires.");
      await refreshOrders();
    });
  }
  async function changeOrder(path: string, body: object) {
    await action(async () => {
      await api(path, body);
      await refreshOrders();
      if (user?.role === "ADMIN" && screen === "operations")
        await refreshOverview();
      setMessage("Order updated successfully.");
    });
  }
  async function external(o: Order, provider: string) {
    await action(async () => {
      const r = await api<{ url: string }>("/orders/" + o.id + "/checkout", {
        provider,
      });
      const u = new URL(r.url);
      const hosts =
        provider === "stripe"
          ? ["checkout.stripe.com"]
          : ["sandbox.payment.bkash.com", "tokenized.sandbox.bka.sh"];
      if (u.protocol !== "https:" || !hosts.includes(u.hostname))
        throw new Error("Untrusted checkout URL");
      window.location.assign(u.href);
    });
  }
  const isOps = user?.role === "STAFF" || user?.role === "ADMIN";
  return (
    <>
      <div className="top-strip">
        Thoughtful essentials. Reliable ordering.{" "}
        <span>Local demo · no real money in simulation</span>
      </div>
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setScreen("store");
          }}
        >
          <span className="brand-mark">
            <ShoppingBag size={21} />
          </span>
          Commerce<span>Flow</span>
        </a>
        <nav>
          <button
            className={screen === "store" ? "active" : ""}
            onClick={() => setScreen("store")}
          >
            Discover
          </button>
          {user && (
            <button
              className={screen === "orders" ? "active" : ""}
              onClick={() => {
                setScreen("orders");
                setOrderPage(1);
              }}
            >
              Orders
            </button>
          )}
          {isOps && (
            <button
              className={screen === "operations" ? "active" : ""}
              onClick={() => setScreen("operations")}
            >
              Operations
            </button>
          )}
        </nav>
        <div className="header-actions">
          {user ? (
            <>
              <button
                className="icon-button"
                aria-label="Notifications"
                onClick={() => setScreen("notifications")}
              >
                <Bell size={19} />
              </button>
              <span className="user-name">
                {user.name.split(" ")[0]}
                <small>{user.role.toLowerCase()}</small>
              </span>
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={() =>
                  action(async () => {
                    await api("/auth/logout", {});
                    setUser(null);
                    setCsrf("");
                    setOrders([]);
                    setSelected(null);
                    setOverview(null);
                    setNotifications([]);
                    setScreen("store");
                  })
                }
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <button className="text-button" onClick={() => setLogin(true)}>
              Sign in
            </button>
          )}
          <button
            className="cart-button"
            onClick={() => setCartOpen(!cartOpen)}
            aria-label="Open shopping bag"
          >
            <ShoppingBag size={18} />
            <span>{count}</span>
          </button>
        </div>
      </header>
      <main>
        {error && (
          <div role="alert" className="notice error">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {message && (
          <div role="status" className="notice success">
            <CheckCircle2 size={18} />
            {message}
            <button onClick={() => setMessage("")} aria-label="Dismiss message">
              <X size={16} />
            </button>
          </div>
        )}
        {screen === "store" && (
          <>
            <section className="hero">
              <div>
                <span className="eyebrow">THE EVERYDAY COLLECTION</span>
                <h1>
                  Better essentials.
                  <br />
                  <em>Simpler days.</em>
                </h1>
                <p>
                  Carefully selected tools for work, travel and everything in
                  between. Build your everyday collection.
                </p>
                <a className="primary" href="#collection">
                  Explore the collection
                  <ArrowRight size={17} />
                </a>
                <div className="hero-proof">
                  <span>
                    <ShieldCheck size={15} /> Secure checkout
                  </span>
                  <span>
                    <Truck size={15} /> Transparent delivery
                  </span>
                </div>
              </div>
              <div className="hero-art">
                <span className="hero-ring" />
                <Headphones
                  className="hero-headphones"
                  size={200}
                  strokeWidth={0.8}
                />
                <div className="hero-label">
                  <span>DESIGNED FOR YOUR DAY</span>
                  <strong>The Arc Collection</strong>
                  <small>Sound, beautifully considered.</small>
                </div>
                <span className="hero-index">01 / 08</span>
              </div>
            </section>
            <section className="collection" id="collection">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">SHOP THE COLLECTION</span>
                  <h2>Made for everyday.</h2>
                </div>
                <span className="muted">{total} curated essentials</span>
              </div>
              <div className="catalog-toolbar">
                <div className="tabs">
                  <button
                    className={!category ? "selected" : ""}
                    onClick={() => {
                      setCategory("");
                      setPage(1);
                    }}
                  >
                    All products
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c}
                      className={category === c ? "selected" : ""}
                      onClick={() => {
                        setCategory(c);
                        setPage(1);
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search products"
                    placeholder="Search the collection"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
              </div>
              {loading ? (
                <div className="empty">Loading the collection...</div>
              ) : products.length === 0 ? (
                <div className="empty">No products match your search.</div>
              ) : (
                <div className="product-grid">
                  {products.map((p) => (
                    <article className="product" key={p.id}>
                      <ProductArt p={p} />
                      <div className="product-info">
                        <span className="eyebrow">{p.category}</span>
                        <h3>{p.name}</h3>
                        <p>{p.description}</p>
                        <div className="product-bottom">
                          <div>
                            <strong>{money(p.price)}</strong>
                            <small>
                              {p.available > 0
                                ? `${p.available} available`
                                : "Currently sold out"}
                            </small>
                          </div>
                          <button
                            className="add-button"
                            disabled={
                              p.available <= 0 ||
                              user?.role === "ADMIN" ||
                              user?.role === "STAFF"
                            }
                            onClick={() => add(p)}
                            aria-label={"Add " + p.name}
                          >
                            <Plus size={19} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {total > 12 && (
                <div className="pagination">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span>Page {page}</span>
                  <button
                    disabled={page * 12 >= total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
            <section className="values">
              <div>
                <Package />
                <h3>Reserved for you</h3>
                <p>
                  Checkout creates a temporary stock reservation, verified by
                  the server.
                </p>
              </div>
              <div>
                <ShieldCheck />
                <h3>Clear payment status</h3>
                <p>
                  Every order includes payment status and an auditable timeline.
                </p>
              </div>
              <div>
                <Truck />
                <h3>From order to doorstep</h3>
                <p>
                  Track packing, shipment, delivery and return requests in one
                  place.
                </p>
              </div>
            </section>
          </>
        )}
        {(screen === "orders" || screen === "operations") && user && (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  {screen === "operations"
                    ? "FULFILLMENT WORKSPACE"
                    : "YOUR ACCOUNT"}
                </span>
                <h1 className="page-title">
                  {screen === "operations" ? "Operations" : "Your orders"}
                </h1>
                <p className="muted">
                  {screen === "operations"
                    ? "Manage inventory, fulfillment and recovery."
                    : "Payment, delivery and returns in one place."}
                </p>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await refreshOrders();
                    if (screen === "operations" && user.role === "ADMIN")
                      await refreshOverview();
                  })
                }
              >
                <RefreshCw size={16} /> Refresh
              </button>
            </div>
            {screen === "operations" && overview && user.role === "ADMIN" && (
              <>
                <div className="metrics">
                  <div>
                    <span>Total orders</span>
                    <strong>{overview.totals.orders}</strong>
                  </div>
                  <div>
                    <span>Unpaid orders</span>
                    <strong>{overview.totals.pending}</strong>
                  </div>
                  <div>
                    <span>Gross booked value</span>
                    <strong>
                      {money(Number(overview.totals.gross_booked_paisa))}
                    </strong>
                    <small>Paid / packed / shipped / delivered orders</small>
                  </div>
                  <div>
                    <span>Worker</span>
                    <strong>
                      {overview.workers.some((w) => w.healthy)
                        ? "Online"
                        : "No heartbeat"}
                    </strong>
                  </div>
                </div>
                <section className="panel">
                  <div className="section-heading">
                    <h2>Inventory</h2>
                    <button
                      className="secondary"
                      onClick={() => {
                        const sku = prompt(
                          "SKU (uppercase letters, numbers and hyphens)",
                        );
                        if (!sku) return;
                        const name = prompt("Product name");
                        if (!name) return;
                        const category = prompt("Category", "Essentials");
                        const description = prompt(
                          "Description (at least 10 characters)",
                        );
                        const price = Number(
                          prompt("Price in paisa (BDT × 100)", "100000"),
                        );
                        const onHand = Number(prompt("Opening stock", "10"));
                        action(async () => {
                          await api("/admin/products", {
                            sku,
                            name,
                            category,
                            description,
                            price,
                            onHand,
                          });
                          await refreshOverview();
                          setMessage("Product created.");
                        });
                      }}
                    >
                      Add product
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Price</th>
                          <th>On hand</th>
                          <th>Reserved</th>
                          <th>Available</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.products.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.name}</strong>
                              <small>
                                {p.sku} · v{p.version}
                              </small>
                            </td>
                            <td>{money(p.price)}</td>
                            <td>{p.on_hand}</td>
                            <td>{p.reserved}</td>
                            <td>{p.available}</td>
                            <td>
                              <button
                                className="table-button"
                                disabled={busy}
                                onClick={() => {
                                  const raw = prompt(
                                    "Quantity to receive",
                                    "10",
                                  );
                                  if (raw === null) return;
                                  action(async () => {
                                    await api(
                                      "/admin/products/" + p.id + "/restock",
                                      { quantity: Number(raw) },
                                      "POST",
                                      crypto.randomUUID(),
                                    );
                                    await refreshOverview();
                                    setMessage("Stock received.");
                                  });
                                }}
                              >
                                Restock
                              </button>
                              <button
                                className="table-button"
                                disabled={busy}
                                onClick={() => {
                                  const raw = prompt(
                                    "New price in paisa",
                                    String(p.price),
                                  );
                                  if (raw === null) return;
                                  action(async () => {
                                    await api(
                                      "/admin/products/" + p.id,
                                      {
                                        price: Number(raw),
                                        active: p.active,
                                        version: p.version,
                                      },
                                      "PATCH",
                                    );
                                    await refreshOverview();
                                  });
                                }}
                              >
                                Price
                              </button>
                              <button
                                className="table-button"
                                disabled={busy}
                                onClick={() =>
                                  action(async () => {
                                    await api(
                                      "/admin/products/" + p.id,
                                      {
                                        price: p.price,
                                        active: !p.active,
                                        version: p.version,
                                      },
                                      "PATCH",
                                    );
                                    await refreshOverview();
                                  })
                                }
                              >
                                {p.active ? "Deactivate" : "Activate"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="panel">
                  <div className="section-heading">
                    <h2>Promotions</h2>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        const code = prompt(
                          "Coupon code (uppercase)",
                          "SAVE15",
                        );
                        if (!code) return;
                        const percent = Number(
                          prompt("Discount percentage (1–50)", "15"),
                        );
                        const minimum = Number(
                          prompt("Minimum subtotal in paisa", "100000"),
                        );
                        const maxUses = Number(
                          prompt("Maximum reservations", "100"),
                        );
                        action(async () => {
                          await api("/admin/coupons", {
                            code,
                            percent,
                            minimum,
                            maxUses,
                            days: 30,
                          });
                          await refreshOverview();
                        });
                      }}
                    >
                      Create coupon
                    </button>
                  </div>
                  <div className="coupon-list">
                    {overview.coupons.map((c) => (
                      <div key={c.code}>
                        <strong>{c.code}</strong>
                        <span>
                          {c.percent}% off · minimum {money(c.minimum)} ·{" "}
                          {c.used}/{c.max_uses} reservations
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="hint">
                    Coupon usage is consumed at reservation and is not restored
                    after cancellation or expiry.
                  </p>
                </section>
                <section className="panel">
                  <h2>Refund obligations</h2>
                  {overview.refunds.length === 0 ? (
                    <p className="muted">No refunds yet.</p>
                  ) : (
                    overview.refunds.map((r) => (
                      <div className="job-row" key={r.id}>
                        <div>
                          <strong>
                            {r.order_id.slice(0, 8)} · {money(r.amount)}
                          </strong>
                          <small>
                            {r.provider} · {r.reason}
                          </small>
                        </div>
                        <Badge status={r.status} />
                        {r.provider !== "sandbox" && r.status === "PENDING" && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => {
                              const reference = prompt(
                                "Reference of refund already processed in the merchant portal",
                              );
                              if (!reference) return;
                              action(async () => {
                                await api(
                                  "/admin/refunds/" +
                                    r.id +
                                    "/record-completion",
                                  { reference },
                                );
                                await refreshOverview();
                              });
                            }}
                          >
                            Record merchant refund
                          </button>
                        )}
                      </div>
                    ))
                  )}
                  <p className="hint">
                    External refunds require merchant action. This button
                    records completion; it does not transfer money.
                  </p>
                </section>
                <section className="panel">
                  <h2>Inventory ledger</h2>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Movement</th>
                          <th>On-hand delta</th>
                          <th>Reserved delta</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.ledger.map((l) => (
                          <tr key={l.id}>
                            <td>{l.sku}</td>
                            <td>{l.kind}</td>
                            <td>{l.on_hand_delta}</td>
                            <td>{l.reserved_delta}</td>
                            <td>{new Date(l.created_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="panel">
                  <h2>Pending background jobs</h2>
                  {overview.outbox.length === 0 ? (
                    <p className="muted">All jobs processed.</p>
                  ) : (
                    overview.outbox.map((j) => (
                      <div className="job-row" key={j.id}>
                        <div>
                          <strong>{j.kind}</strong>
                          <small>
                            {j.last_error ?? "Waiting for delivery"} · failed
                            attempts {j.attempts}
                          </small>
                        </div>
                        {j.last_error && (
                          <button
                            disabled={busy}
                            className="secondary"
                            onClick={() =>
                              action(async () => {
                                await api("/admin/jobs/" + j.id + "/retry", {});
                                await refreshOverview();
                              })
                            }
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </section>
              </>
            )}
            <section className="panel">
              <h2>{isOps ? "Order queue" : "Order history"}</h2>
              {orders.length === 0 ? (
                <div className="empty">
                  No orders yet. Explore the collection to get started.
                </div>
              ) : (
                orders.map((o) => (
                  <button
                    key={o.id}
                    className="order-row"
                    onClick={() =>
                      action(async () => {
                        setSelected(await api<Order>("/orders/" + o.id));
                      })
                    }
                  >
                    <div>
                      <strong>Order #{o.id.slice(0, 8).toUpperCase()}</strong>
                      <small>
                        {new Date(o.created_at).toLocaleDateString()} ·{" "}
                        {o.items.reduce((a, i) => a + i.quantity, 0)} items
                        {isOps ? " · " + o.customer_name : ""}
                      </small>
                    </div>
                    <Badge status={o.status} />
                    <strong>{money(o.total)}</strong>
                    <ArrowRight size={17} />
                  </button>
                ))
              )}
              {orderTotal > 10 && (
                <div className="pagination">
                  <button
                    disabled={orderPage <= 1}
                    onClick={() => setOrderPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span>Page {orderPage}</span>
                  <button
                    disabled={orderPage * 10 >= orderTotal}
                    onClick={() => setOrderPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
          </>
        )}
        {screen === "notifications" && user && (
          <section className="panel">
            <h1 className="page-title">Notifications</h1>
            <p className="muted">
              In-app updates delivered by the background worker.
            </p>
            {notifications.length === 0 ? (
              <div className="empty">No notifications yet.</div>
            ) : (
              notifications.map((n) => (
                <button
                  className="order-row"
                  key={n.id}
                  onClick={() =>
                    action(async () => {
                      setSelected(await api<Order>("/orders/" + n.order_id));
                    })
                  }
                >
                  <div>
                    <strong>{n.message}</strong>
                    <small>{new Date(n.created_at).toLocaleString()}</small>
                  </div>
                  <ArrowRight size={17} />
                </button>
              ))
            )}
          </section>
        )}
      </main>
      <footer>
        <a className="brand" href="#">
          Commerce<span>Flow</span>
        </a>
        <span>Thoughtful products. Transactional ordering.</span>
        <a href="/api/docs" target="_blank" rel="noreferrer">
          API documentation ↗
        </a>
      </footer>
      {cartOpen && (
        <div className="drawer-backdrop" onClick={() => setCartOpen(false)}>
          <aside
            className="drawer"
            onClick={(e) => e.stopPropagation()}
            aria-label="Shopping bag"
          >
            <div className="section-heading">
              <h2>
                Your bag <span className="muted">({count})</span>
              </h2>
              <button
                className="icon-button"
                aria-label="Close shopping bag"
                onClick={() => setCartOpen(false)}
              >
                <X />
              </button>
            </div>
            {count === 0 ? (
              <div className="empty">
                <ShoppingBag size={40} />
                <h3>Your bag is waiting.</h3>
                <p>Add an everyday essential to get started.</p>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {Object.entries(cart)
                    .filter(([, q]) => q > 0)
                    .map(([id, q]) => {
                      const p = cartProducts[id];
                      if (!p) return null;
                      return (
                        <div className="cart-item" key={id}>
                          <div className="cart-art">
                            <Package size={27} />
                          </div>
                          <div>
                            <strong>{p.name}</strong>
                            <small>{money(p.price)}</small>
                            <div className="quantity">
                              <button
                                aria-label={"Decrease " + p.name}
                                onClick={() =>
                                  setCart((c) => ({
                                    ...c,
                                    [id]: Math.max(0, q - 1),
                                  }))
                                }
                              >
                                <Minus size={13} />
                              </button>
                              <span>{q}</span>
                              <button
                                disabled={q >= 10 || q >= p.available}
                                aria-label={"Increase " + p.name}
                                onClick={() =>
                                  setCart((c) => ({ ...c, [id]: q + 1 }))
                                }
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                          </div>
                          <strong>{money(p.price * q)}</strong>
                        </div>
                      );
                    })}
                </div>
                <div className="cart-total">
                  <span>Estimated subtotal</span>
                  <strong>{money(subtotal)}</strong>
                </div>
                <p className="hint">
                  Server prices and stock are checked at reservation. Delivery:
                  BDT 49.90, free for discounted merchandise of BDT 2,500 or
                  more.
                </p>
                <form onSubmit={checkout} className="address-form">
                  <h3>Delivery details</h3>
                  <label>
                    Recipient name
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={80}
                      defaultValue={user?.name}
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Phone
                      <input
                        name="phone"
                        required
                        pattern="\+?[0-9 -]{8,20}"
                        maxLength={20}
                        placeholder="01XXXXXXXXX"
                      />
                    </label>
                    <label>
                      City
                      <input
                        name="city"
                        required
                        minLength={2}
                        maxLength={60}
                        defaultValue="Dhaka"
                      />
                    </label>
                  </div>
                  <label>
                    Street address
                    <input
                      name="street"
                      required
                      minLength={5}
                      maxLength={180}
                    />
                  </label>
                  <label>
                    Coupon code
                    <input
                      name="coupon"
                      maxLength={24}
                      placeholder="Try WELCOME10"
                    />
                  </label>
                  {user && user.role !== "CUSTOMER" ? (
                    <p className="error">
                      Use a customer account to place an order.
                    </p>
                  ) : (
                    <button className="primary" disabled={busy}>
                      {busy
                        ? "Reserving..."
                        : user
                          ? "Reserve & checkout"
                          : "Sign in to checkout"}
                      <ArrowRight size={17} />
                    </button>
                  )}
                </form>
              </>
            )}
          </aside>
        </div>
      )}
      {selected && (
        <div className="modal-backdrop">
          <section
            className="modal order-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Order details"
          >
            <button
              className="icon-button modal-close"
              onClick={() => setSelected(null)}
              aria-label="Close order details"
            >
              <X />
            </button>
            <span className="eyebrow">
              ORDER #{selected.id.slice(0, 8).toUpperCase()}
            </span>
            <h2>Your order, at a glance.</h2>
            <Badge status={selected.status} />
            {selected.status === "PENDING" && (
              <p className="countdown">
                Hold remaining:{" "}
                {Math.max(
                  0,
                  Math.floor((Date.parse(selected.expires_at) - now) / 60000),
                )}
                m{" "}
                {Math.max(
                  0,
                  Math.floor((Date.parse(selected.expires_at) - now) / 1000) %
                    60,
                )}
                s
              </p>
            )}
            <div className="order-lines">
              {selected.items.map((i) => (
                <div key={i.product_id}>
                  <span>
                    {i.name}
                    <small>
                      {i.quantity} × {money(i.price)}
                    </small>
                  </span>
                  <strong>{money(i.price * i.quantity)}</strong>
                </div>
              ))}
              <div>
                <span>Subtotal</span>
                <span>{money(selected.subtotal)}</span>
              </div>
              <div>
                <span>Discount</span>
                <span>−{money(selected.discount)}</span>
              </div>
              <div>
                <span>Delivery</span>
                <span>{money(selected.shipping)}</span>
              </div>
              <div className="grand-total">
                <strong>Total</strong>
                <strong>{money(selected.total)}</strong>
              </div>
            </div>
            <p className="hint">
              Payment: {selected.payment.provider} / {selected.payment.state}.
              Prices are snapshotted at reservation.
            </p>
            <div className="order-actions">
              {user?.role === "CUSTOMER" &&
                selected.status === "PENDING" &&
                selected.payment.provider === "sandbox" &&
                methods.sandbox && (
                  <>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        changeOrder("/orders/" + selected.id + "/simulate", {
                          outcome: "success",
                        })
                      }
                    >
                      Simulate successful payment
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        changeOrder("/orders/" + selected.id + "/simulate", {
                          outcome: "failed",
                        })
                      }
                    >
                      Simulate decline
                    </button>
                  </>
                )}
              {user?.role === "CUSTOMER" &&
                selected.status === "PENDING" &&
                (["stripe", "bkash"] as const)
                  .filter(
                    (p) =>
                      methods[p] &&
                      (selected.payment.provider === "sandbox" ||
                        selected.payment.provider === p),
                  )
                  .map((p) => (
                    <button
                      key={p}
                      className="secondary"
                      disabled={busy}
                      onClick={() => external(selected, p)}
                    >
                      Pay with{" "}
                      {p === "stripe"
                        ? "Stripe test checkout"
                        : "bKash sandbox"}
                    </button>
                  ))}
              {selected.payment.provider !== "sandbox" &&
                selected.payment.state !== "SUCCEEDED" &&
                user?.role !== "STAFF" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      changeOrder(
                        "/payments/" + selected.payment.id + "/verify",
                        {},
                      )
                    }
                  >
                    Check provider payment
                  </button>
                )}
              {["PENDING", "PAID", "PACKED"].includes(selected.status) &&
                user?.role !== "STAFF" && (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Cancel this order?"))
                        changeOrder("/orders/" + selected.id + "/cancel", {});
                    }}
                  >
                    Cancel order
                  </button>
                )}
              {isOps &&
                ["PAID", "PACKED", "SHIPPED"].includes(selected.status) && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      const status = (
                        {
                          PAID: "PACKED",
                          PACKED: "SHIPPED",
                          SHIPPED: "DELIVERED",
                        } as Record<string, string>
                      )[selected.status];
                      const tracking =
                        status === "SHIPPED"
                          ? prompt("Shipment tracking reference")
                          : undefined;
                      if (status === "SHIPPED" && !tracking) return;
                      changeOrder("/orders/" + selected.id + "/fulfill", {
                        status,
                        ...(tracking ? { tracking } : {}),
                      });
                    }}
                  >
                    Mark{" "}
                    {
                      (
                        {
                          PAID: "packed",
                          PACKED: "shipped",
                          SHIPPED: "delivered",
                        } as Record<string, string>
                      )[selected.status]
                    }
                  </button>
                )}
              {user?.role === "CUSTOMER" &&
                selected.status === "DELIVERED" &&
                !selected.return && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      const reason = prompt(
                        "Reason for returning the full order (at least 5 characters)",
                      );
                      if (reason)
                        changeOrder("/orders/" + selected.id + "/return", {
                          reason,
                        });
                    }}
                  >
                    Request return
                  </button>
                )}
              {user?.role === "ADMIN" &&
                selected.return?.status === "REQUESTED" && (
                  <>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "Confirm all items were received and can be restocked?",
                          )
                        )
                          changeOrder(
                            "/admin/orders/" + selected.id + "/return-decision",
                            { status: "APPROVED" },
                          );
                      }}
                    >
                      Approve received return
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        changeOrder(
                          "/admin/orders/" + selected.id + "/return-decision",
                          { status: "REJECTED" },
                        )
                      }
                    >
                      Reject return
                    </button>
                  </>
                )}
            </div>
            {selected.refund && (
              <div className="notice success">
                Refund: {money(selected.refund.amount)} ·{" "}
                {selected.refund.status}
                {selected.payment.provider !== "sandbox"
                  ? " · merchant processing required"
                  : ""}
              </div>
            )}
            {selected.return && (
              <p>
                Return: {selected.return.status} · {selected.return.reason}
              </p>
            )}
            <h3>Delivery address</h3>
            <p className="muted">
              {selected.address.name} · {selected.address.phone}
              <br />
              {selected.address.street}, {selected.address.city}
            </p>
            {selected.tracking && (
              <p>
                Tracking: <strong>{selected.tracking}</strong>
              </p>
            )}
            <h3>Order timeline</h3>
            <ol className="timeline">
              {selected.timeline.map((t, i) => (
                <li key={i}>
                  <span>{t.action.replaceAll("_", " ").toLowerCase()}</span>
                  <small>{new Date(t.created_at).toLocaleString()}</small>
                </li>
              ))}
            </ol>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                action(async () =>
                  setSelected(await api<Order>("/orders/" + selected.id)),
                )
              }
            >
              Refresh this order
            </button>
          </section>
        </div>
      )}
      {login && (
        <Login
          close={() => setLogin(false)}
          done={(u) => {
            setUser(u);
            setLogin(false);
            setMessage("Signed in successfully.");
          }}
        />
      )}
    </>
  );
}
