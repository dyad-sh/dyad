import { useEffect, useState } from "react";

// An interactive app for the test-recorder E2E: it exercises the recorder's
// click / fill / check / select / navigate capture and its non-dyadId selector
// strategies (this imported app has no component tagger).
const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [count, setCount] = useState(0);
  const [name, setName] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [color, setColor] = useState("red");
  const [route, setRoute] = useState("/");

  useEffect(() => {
    void fetch("/api/auth/get-session", { credentials: "include" })
      .then((response) => response.json())
      .then((session) => setIsAuthenticated(Boolean(session?.user)));
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Recorder Test App</h1>
      <p data-testid="auth-state">
        {isAuthenticated ? "Signed in" : "Signed out"}
      </p>

      <button onClick={() => setCount((c) => c + 1)}>Increment</button>
      <p data-testid="count">Count: {count}</p>

      <label htmlFor="name-input">Name</label>
      <input
        id="name-input"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <p data-testid="greeting">{name ? `Hello, ${name}` : "Hello"}</p>

      <label>
        <input
          type="checkbox"
          checked={subscribed}
          onChange={(e) => setSubscribed(e.target.checked)}
        />
        Subscribe
      </label>

      <label htmlFor="color-select">Color</label>
      <select
        id="color-select"
        value={color}
        onChange={(e) => setColor(e.target.value)}
      >
        <option value="red">Red</option>
        <option value="green">Green</option>
        <option value="blue">Blue</option>
      </select>

      <button
        onClick={() => {
          history.pushState({}, "", "/second");
          setRoute("/second");
        }}
      >
        Go to second
      </button>
      <p data-testid="route">Route: {route}</p>
    </div>
  );
};

export default App;
