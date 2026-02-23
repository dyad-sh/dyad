/**
 * Scraping Templates — 15+ built-in templates for common data sources
 *
 * Each template provides pre-configured selectors, fields, extraction
 * strategy, and auto-tag rules for a specific content type.
 */

import type { ScrapingTemplate } from "./types";

export const BUILTIN_TEMPLATES: ScrapingTemplate[] = [
  // ── E-commerce ──────────────────────────────────────────────────────────
  {
    id: "ecommerce-products",
    name: "E-commerce Products",
    description: "Extract product name, price, images, description, and ratings from product listing pages.",
    category: "E-commerce",
    icon: "ShoppingCart",
    config: {
      sourceType: "web",
      mode: "hybrid",
      output: { format: "json", extractImages: true, extractStructuredData: true },
      autoTag: { enabled: true, classifyTopics: true },
    },
    fields: [
      { id: "title", name: "Product Title", type: "text", selectorStrategy: "css", selector: "h1, [itemprop='name']", required: true },
      { id: "price", name: "Price", type: "number", selectorStrategy: "css", selector: "[itemprop='price'], .price, .product-price", attribute: "content", transform: "number" },
      { id: "currency", name: "Currency", type: "text", selectorStrategy: "css", selector: "[itemprop='priceCurrency']", attribute: "content" },
      { id: "description", name: "Description", type: "text", selectorStrategy: "css", selector: "[itemprop='description'], .product-description" },
      { id: "image", name: "Product Image", type: "image", selectorStrategy: "css", selector: "[itemprop='image'], .product-image img", attribute: "src" },
      { id: "rating", name: "Rating", type: "number", selectorStrategy: "css", selector: "[itemprop='ratingValue']", attribute: "content", transform: "number" },
      { id: "reviewCount", name: "Review Count", type: "number", selectorStrategy: "css", selector: "[itemprop='reviewCount']", attribute: "content", transform: "number" },
      { id: "sku", name: "SKU", type: "text", selectorStrategy: "css", selector: "[itemprop='sku']", attribute: "content" },
      { id: "brand", name: "Brand", type: "text", selectorStrategy: "css", selector: "[itemprop='brand'] [itemprop='name']" },
      { id: "availability", name: "Availability", type: "text", selectorStrategy: "css", selector: "[itemprop='availability']", attribute: "href" },
    ],
    sampleOutput: { title: "Wireless Headphones Pro", price: 79.99, currency: "USD", rating: 4.5, reviewCount: 1234 },
    isBuiltin: true,
  },

  // ── News / Articles ─────────────────────────────────────────────────────
  {
    id: "news-articles",
    name: "News Articles",
    description: "Extract article headline, author, published date, body text, and images from news sites.",
    category: "News",
    icon: "Newspaper",
    config: {
      sourceType: "web",
      mode: "hybrid",
      output: { format: "markdown", extractImages: true, extractStructuredData: true },
      autoTag: { enabled: true, detectSentiment: true, extractEntities: true, classifyTopics: true },
    },
    fields: [
      { id: "headline", name: "Headline", type: "text", selectorStrategy: "css", selector: "h1, [itemprop='headline']", required: true },
      { id: "author", name: "Author", type: "text", selectorStrategy: "css", selector: "[itemprop='author'], .author, .byline, [rel='author']" },
      { id: "publishDate", name: "Publish Date", type: "date", selectorStrategy: "css", selector: "time[datetime], [itemprop='datePublished']", attribute: "datetime" },
      { id: "content", name: "Article Body", type: "text", selectorStrategy: "css", selector: "article, .article-body, .post-content, [itemprop='articleBody']" },
      { id: "category", name: "Category", type: "text", selectorStrategy: "css", selector: "[itemprop='articleSection'], .category" },
      { id: "heroImage", name: "Hero Image", type: "image", selectorStrategy: "css", selector: "article img:first-of-type, .hero-image img", attribute: "src" },
    ],
    sampleOutput: { headline: "Breaking: AI Advances in 2026", author: "Jane Doe", publishDate: "2026-02-22", category: "Technology" },
    isBuiltin: true,
  },

  // ── Social Profiles ─────────────────────────────────────────────────────
  {
    id: "social-profiles",
    name: "Social Media Profiles",
    description: "Extract profile name, bio, follower count, and avatar from public social profiles.",
    category: "Social",
    icon: "Users",
    config: {
      sourceType: "web",
      mode: "playwright",
      output: { format: "json", extractImages: true },
      playwrightOptions: { waitForTimeout: 3000 },
      autoTag: { enabled: true },
    },
    fields: [
      { id: "name", name: "Display Name", type: "text", selectorStrategy: "css", selector: "h1, h2, .profile-name", required: true },
      { id: "username", name: "Username", type: "text", selectorStrategy: "css", selector: ".username, [data-testid='UserName']" },
      { id: "bio", name: "Bio", type: "text", selectorStrategy: "css", selector: ".bio, .profile-bio, [data-testid='UserDescription']" },
      { id: "followers", name: "Followers", type: "number", selectorStrategy: "css", selector: ".followers-count, [data-testid='followers']", transform: "number" },
      { id: "following", name: "Following", type: "number", selectorStrategy: "css", selector: ".following-count, [data-testid='following']", transform: "number" },
      { id: "avatar", name: "Avatar", type: "image", selectorStrategy: "css", selector: ".avatar img, .profile-image img", attribute: "src" },
      { id: "posts", name: "Post Count", type: "number", selectorStrategy: "css", selector: ".posts-count", transform: "number" },
      { id: "location", name: "Location", type: "text", selectorStrategy: "css", selector: ".location, [data-testid='UserLocation']" },
      { id: "website", name: "Website", type: "url", selectorStrategy: "css", selector: ".website a, [data-testid='UserUrl'] a", attribute: "href" },
    ],
    sampleOutput: { name: "John Doe", username: "@johndoe", followers: 15200, bio: "Tech enthusiast" },
    isBuiltin: true,
  },

  // ── Job Listings ────────────────────────────────────────────────────────
  {
    id: "job-listings",
    name: "Job Listings",
    description: "Extract job title, company, location, salary, and description from job boards.",
    category: "Jobs",
    icon: "Briefcase",
    config: {
      sourceType: "web",
      mode: "hybrid",
      output: { format: "json", extractStructuredData: true },
      autoTag: { enabled: true, classifyTopics: true },
    },
    fields: [
      { id: "title", name: "Job Title", type: "text", selectorStrategy: "css", selector: "h1, [itemprop='title'], .job-title", required: true },
      { id: "company", name: "Company", type: "text", selectorStrategy: "css", selector: "[itemprop='hiringOrganization'] [itemprop='name'], .company-name", required: true },
      { id: "location", name: "Location", type: "text", selectorStrategy: "css", selector: "[itemprop='jobLocation'], .job-location" },
      { id: "salary", name: "Salary", type: "text", selectorStrategy: "css", selector: "[itemprop='baseSalary'], .salary" },
      { id: "employmentType", name: "Employment Type", type: "text", selectorStrategy: "css", selector: "[itemprop='employmentType']" },
      { id: "description", name: "Job Description", type: "text", selectorStrategy: "css", selector: "[itemprop='description'], .job-description" },
      { id: "datePosted", name: "Date Posted", type: "date", selectorStrategy: "css", selector: "[itemprop='datePosted']", attribute: "content" },
      { id: "qualifications", name: "Qualifications", type: "text", selectorStrategy: "css", selector: ".qualifications, .requirements" },
    ],
    sampleOutput: { title: "Senior AI Engineer", company: "TechCorp", location: "Remote", salary: "$150k-$200k" },
    isBuiltin: true,
  },

  // ── Reviews & Ratings ───────────────────────────────────────────────────
  {
    id: "reviews-ratings",
    name: "Reviews & Ratings",
    description: "Extract reviewer name, rating, title, content, and date from review pages.",
    category: "Reviews",
    icon: "Star",
    config: {
      sourceType: "web",
      mode: "hybrid",
      output: { format: "json", extractStructuredData: true },
      autoTag: { enabled: true, detectSentiment: true },
    },
    fields: [
      { id: "reviewer", name: "Reviewer", type: "text", selectorStrategy: "css", selector: "[itemprop='author'] [itemprop='name'], .reviewer-name" },
      { id: "rating", name: "Rating", type: "number", selectorStrategy: "css", selector: "[itemprop='ratingValue']", attribute: "content", transform: "number", required: true },
      { id: "title", name: "Review Title", type: "text", selectorStrategy: "css", selector: "[itemprop='name'], .review-title" },
      { id: "content", name: "Review Content", type: "text", selectorStrategy: "css", selector: "[itemprop='reviewBody'], .review-text", required: true },
      { id: "date", name: "Review Date", type: "date", selectorStrategy: "css", selector: "[itemprop='datePublished']", attribute: "content" },
      { id: "verified", name: "Verified Purchase", type: "boolean", selectorStrategy: "css", selector: ".verified-purchase", transform: "boolean" },
    ],
    sampleOutput: { reviewer: "Jane S.", rating: 4, title: "Great product!", content: "Really satisfied with the quality.", verified: true },
    isBuiltin: true,
  },

  // ── Research Papers ─────────────────────────────────────────────────────
  {
    id: "research-papers",
    name: "Research Papers",
    description: "Extract title, authors, abstract, citations, and metadata from academic paper pages.",
    category: "Academic",
    icon: "GraduationCap",
    config: {
      sourceType: "web",
      mode: "http",
      output: { format: "json", extractStructuredData: true, extractLinks: true },
      autoTag: { enabled: true, classifyTopics: true, extractEntities: true },
    },
    fields: [
      { id: "title", name: "Paper Title", type: "text", selectorStrategy: "css", selector: "h1, .paper-title, [itemprop='name']", required: true },
      { id: "authors", name: "Authors", type: "array", selectorStrategy: "css", selector: ".author, [itemprop='author'] [itemprop='name'], .authors a" },
      { id: "abstract", name: "Abstract", type: "text", selectorStrategy: "css", selector: ".abstract, [itemprop='description'], blockquote.abstract", required: true },
      { id: "publishDate", name: "Publish Date", type: "date", selectorStrategy: "css", selector: "[itemprop='datePublished'], .publish-date", attribute: "content" },
      { id: "doi", name: "DOI", type: "text", selectorStrategy: "css", selector: ".doi, [data-doi]", attribute: "data-doi" },
      { id: "journal", name: "Journal", type: "text", selectorStrategy: "css", selector: "[itemprop='isPartOf'] [itemprop='name'], .journal-name" },
      { id: "citations", name: "Citation Count", type: "number", selectorStrategy: "css", selector: ".citation-count, .cited-by", transform: "number" },
      { id: "keywords", name: "Keywords", type: "array", selectorStrategy: "css", selector: ".keywords a, .tags a, [itemprop='keywords']" },
      { id: "pdfLink", name: "PDF Link", type: "url", selectorStrategy: "css", selector: "a[href$='.pdf'], .pdf-link a", attribute: "href" },
    ],
    sampleOutput: { title: "Attention Is All You Need", authors: ["Vaswani A.", "Shazeer N."], doi: "10.48550/arXiv.1706.03762" },
    isBuiltin: true,
  },

  // ── Real Estate ─────────────────────────────────────────────────────────
  {
    id: "real-estate",
    name: "Real Estate Listings",
    description: "Extract property details: price, address, bedrooms, bathrooms, square footage, images.",
    category: "Real Estate",
    icon: "Home",
    config: {
      sourceType: "web",
      mode: "hybrid",
      output: { format: "json", extractImages: true, extractStructuredData: true },
      autoTag: { enabled: true },
    },
    fields: [
      { id: "address", name: "Address", type: "text", selectorStrategy: "css", selector: "h1, .property-address, [itemprop='address']", required: true },
      { id: "price", name: "Price", type: "number", selectorStrategy: "css", selector: ".price, [itemprop='price']", transform: "number", required: true },
      { id: "bedrooms", name: "Bedrooms", type: "number", selectorStrategy: "css", selector: ".beds, [data-beds]", transform: "number" },
      { id: "bathrooms", name: "Bathrooms", type: "number", selectorStrategy: "css", selector: ".baths, [data-baths]", transform: "number" },
      { id: "sqft", name: "Square Feet", type: "number", selectorStrategy: "css", selector: ".sqft, [itemprop='floorSize']", transform: "number" },
      { id: "type", name: "Property Type", type: "text", selectorStrategy: "css", selector: ".property-type, [itemprop='@type']" },
      { id: "description", name: "Description", type: "text", selectorStrategy: "css", selector: ".property-description, [itemprop='description']" },
      { id: "agent", name: "Listing Agent", type: "text", selectorStrategy: "css", selector: ".agent-name, [itemprop='agent'] [itemprop='name']" },
      { id: "images", name: "Property Images", type: "array", selectorStrategy: "css", selector: ".property-gallery img, .photo-gallery img", attribute: "src" },
      { id: "yearBuilt", name: "Year Built", type: "number", selectorStrategy: "css", selector: ".year-built", transform: "number" },
    ],
    sampleOutput: { address: "123 Main St, Austin TX", price: 450000, bedrooms: 3, bathrooms: 2, sqft: 2100 },
    isBuiltin: true,
  },

  // ── Recipes ─────────────────────────────────────────────────────────────
  {
    id: "recipes",
    name: "Recipes",
    description: "Extract recipe name, ingredients, instructions, prep time, cook time, nutrition.",
    category: "Food",
    icon: "ChefHat",
    config: {
      sourceType: "web",
      mode: "http",
      output: { format: "json", extractImages: true, extractStructuredData: true },
      autoTag: { enabled: true },
    },
    fields: [
      { id: "name", name: "Recipe Name", type: "text", selectorStrategy: "css", selector: "h1, [itemprop='name']", required: true },
      { id: "description", name: "Description", type: "text", selectorStrategy: "css", selector: "[itemprop='description'], .recipe-summary" },
      { id: "image", name: "Photo", type: "image", selectorStrategy: "css", selector: "[itemprop='image'], .recipe-image img", attribute: "src" },
      { id: "prepTime", name: "Prep Time", type: "text", selectorStrategy: "css", selector: "[itemprop='prepTime']", attribute: "content" },
      { id: "cookTime", name: "Cook Time", type: "text", selectorStrategy: "css", selector: "[itemprop='cookTime']", attribute: "content" },
      { id: "totalTime", name: "Total Time", type: "text", selectorStrategy: "css", selector: "[itemprop='totalTime']", attribute: "content" },
      { id: "servings", name: "Servings", type: "number", selectorStrategy: "css", selector: "[itemprop='recipeYield']", transform: "number" },
      { id: "ingredients", name: "Ingredients", type: "array", selectorStrategy: "css", selector: "[itemprop='recipeIngredient'], .ingredient" },
      { id: "instructions", name: "Instructions", type: "array", selectorStrategy: "css", selector: "[itemprop='recipeInstructions'] [itemprop='text'], .instruction-step" },
      { id: "calories", name: "Calories", type: "number", selectorStrategy: "css", selector: "[itemprop='calories']", transform: "number" },
      { id: "cuisine", name: "Cuisine", type: "text", selectorStrategy: "css", selector: "[itemprop='recipeCuisine']" },
      { id: "category", name: "Category", type: "text", selectorStrategy: "css", selector: "[itemprop='recipeCategory']" },
    ],
    sampleOutput: { name: "Classic Margherita Pizza", prepTime: "PT20M", cookTime: "PT15M", servings: 4, cuisine: "Italian" },
    isBuiltin: true,
  },

  // ── Events ──────────────────────────────────────────────────────────────
  {
    id: "events",
    name: "Events & Conferences",
    description: "Extract event name, date, venue, speakers, price, and description.",
    category: "Events",
    icon: "Calendar",
    config: {
      sourceType: "web",
      mode: "hybrid",
      output: { format: "json", extractStructuredData: true, extractImages: true },
      autoTag: { enabled: true, classifyTopics: true },
    },
    fields: [
      { id: "name", name: "Event Name", type: "text", selectorStrategy: "css", selector: "h1, [itemprop='name']", required: true },
      { id: "startDate", name: "Start Date", type: "date", selectorStrategy: "css", selector: "[itemprop='startDate']", attribute: "content", required: true },
      { id: "endDate", name: "End Date", type: "date", selectorStrategy: "css", selector: "[itemprop='endDate']", attribute: "content" },
      { id: "location", name: "Venue", type: "text", selectorStrategy: "css", selector: "[itemprop='location'] [itemprop='name'], .venue" },
      { id: "address", name: "Address", type: "text", selectorStrategy: "css", selector: "[itemprop='location'] [itemprop='address']" },
      { id: "description", name: "Description", type: "text", selectorStrategy: "css", selector: "[itemprop='description'], .event-description" },
      { id: "price", name: "Ticket Price", type: "text", selectorStrategy: "css", selector: "[itemprop='offers'] [itemprop='price'], .ticket-price" },
      { id: "organizer", name: "Organizer", type: "text", selectorStrategy: "css", selector: "[itemprop='organizer'] [itemprop='name'], .organizer" },
      { id: "speakers", name: "Speakers", type: "array", selectorStrategy: "css", selector: ".speaker-name, .presenter" },
    ],
    sampleOutput: { name: "AI Summit 2026", startDate: "2026-06-15", location: "Convention Center", price: "$299" },
    isBuiltin: true,
  },

  // ── Company Directory ───────────────────────────────────────────────────
  {
    id: "company-directory",
    name: "Company Directories",
    description: "Extract company name, description, address, phone, website, and industry from business listings.",
    category: "Business",
    icon: "Building",
    config: {
      sourceType: "web",
      mode: "http",
      output: { format: "json", extractStructuredData: true },
      autoTag: { enabled: true },
    },
    fields: [
      { id: "name", name: "Company Name", type: "text", selectorStrategy: "css", selector: "h1, [itemprop='name'], .business-name", required: true },
      { id: "description", name: "Description", type: "text", selectorStrategy: "css", selector: "[itemprop='description'], .business-description" },
      { id: "address", name: "Address", type: "text", selectorStrategy: "css", selector: "[itemprop='address'], .business-address" },
      { id: "phone", name: "Phone", type: "text", selectorStrategy: "css", selector: "[itemprop='telephone'], .phone" },
      { id: "website", name: "Website", type: "url", selectorStrategy: "css", selector: "[itemprop='url'], .website a", attribute: "href" },
      { id: "industry", name: "Industry", type: "text", selectorStrategy: "css", selector: ".industry, .category" },
      { id: "employees", name: "Employee Count", type: "number", selectorStrategy: "css", selector: "[itemprop='numberOfEmployees']", transform: "number" },
      { id: "rating", name: "Rating", type: "number", selectorStrategy: "css", selector: "[itemprop='ratingValue']", attribute: "content", transform: "number" },
      { id: "founded", name: "Founded", type: "text", selectorStrategy: "css", selector: "[itemprop='foundingDate'], .founded" },
    ],
    sampleOutput: { name: "TechCorp Inc.", industry: "Software", employees: 500, rating: 4.2, founded: "2015" },
    isBuiltin: true,
  },

  // ── Forum Threads ───────────────────────────────────────────────────────
  {
    id: "forum-threads",
    name: "Forum & Discussion Threads",
    description: "Extract thread title, posts, authors, timestamps, and vote counts from forums.",
    category: "Community",
    icon: "MessageSquare",
    config: {
      sourceType: "web",
      mode: "hybrid",
      output: { format: "json" },
      autoTag: { enabled: true, detectSentiment: true, classifyTopics: true },
    },
    fields: [
      { id: "threadTitle", name: "Thread Title", type: "text", selectorStrategy: "css", selector: "h1, .thread-title", required: true },
      { id: "author", name: "Original Author", type: "text", selectorStrategy: "css", selector: ".post:first-child .author, .original-poster" },
      { id: "postDate", name: "Post Date", type: "date", selectorStrategy: "css", selector: ".post:first-child time, .post:first-child .date", attribute: "datetime" },
      { id: "content", name: "Original Post", type: "text", selectorStrategy: "css", selector: ".post:first-child .content, .post-body:first-of-type" },
      { id: "votes", name: "Votes/Points", type: "number", selectorStrategy: "css", selector: ".score, .votes, .points", transform: "number" },
      { id: "replies", name: "Reply Count", type: "number", selectorStrategy: "css", selector: ".reply-count, .comments-count", transform: "number" },
      { id: "tags", name: "Tags", type: "array", selectorStrategy: "css", selector: ".tag, .label, .flair" },
    ],
    sampleOutput: { threadTitle: "Best practices for AI training data?", votes: 42, replies: 15, tags: ["ai", "datasets", "best-practices"] },
    isBuiltin: true,
  },

  // ── Government / Public Data ────────────────────────────────────────────
  {
    id: "government-data",
    name: "Government / Public Data",
    description: "Extract structured information from government sites: regulations, statistics, public records.",
    category: "Government",
    icon: "Landmark",
    config: {
      sourceType: "web",
      mode: "http",
      output: { format: "json", extractTables: true, extractStructuredData: true },
      autoTag: { enabled: true, extractEntities: true },
    },
    fields: [
      { id: "title", name: "Document Title", type: "text", selectorStrategy: "css", selector: "h1, .document-title", required: true },
      { id: "agency", name: "Agency / Department", type: "text", selectorStrategy: "css", selector: ".agency, .department" },
      { id: "publishDate", name: "Publication Date", type: "date", selectorStrategy: "css", selector: "time[datetime], .pub-date" },
      { id: "documentId", name: "Document ID", type: "text", selectorStrategy: "css", selector: ".document-number, .regulation-id" },
      { id: "content", name: "Content", type: "text", selectorStrategy: "css", selector: "article, .content, main" },
      { id: "status", name: "Status", type: "text", selectorStrategy: "css", selector: ".status, .document-status" },
      { id: "category", name: "Category", type: "text", selectorStrategy: "css", selector: ".category, .document-type" },
    ],
    sampleOutput: { title: "Environmental Protection Regulation 2026-42", agency: "EPA", status: "Active" },
    isBuiltin: true,
  },

  // ── Sports Statistics ───────────────────────────────────────────────────
  {
    id: "sports-stats",
    name: "Sports Statistics",
    description: "Extract player/team stats, scores, schedules, and standings from sports websites.",
    category: "Sports",
    icon: "Trophy",
    config: {
      sourceType: "web",
      mode: "hybrid",
      output: { format: "json", extractTables: true },
      autoTag: { enabled: true },
    },
    fields: [
      { id: "playerName", name: "Player/Team", type: "text", selectorStrategy: "css", selector: "h1, .player-name, .team-name", required: true },
      { id: "sport", name: "Sport", type: "text", selectorStrategy: "css", selector: ".sport, .league" },
      { id: "season", name: "Season", type: "text", selectorStrategy: "css", selector: ".season" },
      { id: "stats", name: "Statistics", type: "object", selectorStrategy: "ai-extract" },
      { id: "record", name: "Win-Loss Record", type: "text", selectorStrategy: "css", selector: ".record, .w-l" },
      { id: "rank", name: "Ranking", type: "number", selectorStrategy: "css", selector: ".rank, .standing-position", transform: "number" },
    ],
    sampleOutput: { playerName: "Team Alpha", sport: "Basketball", record: "42-15", rank: 3 },
    isBuiltin: true,
  },

  // ── Financial Data ──────────────────────────────────────────────────────
  {
    id: "financial-data",
    name: "Financial / Stock Data",
    description: "Extract stock ticker, price, market cap, P/E ratio, and financial metrics.",
    category: "Finance",
    icon: "DollarSign",
    config: {
      sourceType: "web",
      mode: "hybrid",
      output: { format: "json", extractTables: true, extractStructuredData: true },
      autoTag: { enabled: true },
    },
    fields: [
      { id: "ticker", name: "Ticker Symbol", type: "text", selectorStrategy: "css", selector: ".ticker, .symbol, [data-symbol]", required: true },
      { id: "companyName", name: "Company Name", type: "text", selectorStrategy: "css", selector: "h1, .company-name" },
      { id: "price", name: "Current Price", type: "number", selectorStrategy: "css", selector: ".price, [data-price]", transform: "number", required: true },
      { id: "change", name: "Price Change", type: "number", selectorStrategy: "css", selector: ".change, .price-change", transform: "number" },
      { id: "changePercent", name: "Change %", type: "number", selectorStrategy: "css", selector: ".change-percent", transform: "number" },
      { id: "marketCap", name: "Market Cap", type: "text", selectorStrategy: "css", selector: ".market-cap, [data-market-cap]" },
      { id: "peRatio", name: "P/E Ratio", type: "number", selectorStrategy: "css", selector: ".pe-ratio, [data-pe]", transform: "number" },
      { id: "volume", name: "Volume", type: "number", selectorStrategy: "css", selector: ".volume, [data-volume]", transform: "number" },
      { id: "high52w", name: "52W High", type: "number", selectorStrategy: "css", selector: ".high-52w", transform: "number" },
      { id: "low52w", name: "52W Low", type: "number", selectorStrategy: "css", selector: ".low-52w", transform: "number" },
    ],
    sampleOutput: { ticker: "AAPL", companyName: "Apple Inc.", price: 187.43, changePercent: 1.25, marketCap: "$2.9T" },
    isBuiltin: true,
  },

  // ── Podcast / Music Catalog ─────────────────────────────────────────────
  {
    id: "podcast-catalog",
    name: "Podcast & Music Catalogs",
    description: "Extract show/album name, episodes/tracks, duration, descriptions, and artwork.",
    category: "Media",
    icon: "Headphones",
    config: {
      sourceType: "web",
      mode: "http",
      output: { format: "json", extractMedia: true, extractImages: true },
      autoTag: { enabled: true, classifyTopics: true },
    },
    fields: [
      { id: "showName", name: "Show/Album Name", type: "text", selectorStrategy: "css", selector: "h1, [itemprop='name']", required: true },
      { id: "creator", name: "Host/Artist", type: "text", selectorStrategy: "css", selector: "[itemprop='author'], .host, .artist" },
      { id: "description", name: "Description", type: "text", selectorStrategy: "css", selector: "[itemprop='description'], .show-description" },
      { id: "artwork", name: "Cover Art", type: "image", selectorStrategy: "css", selector: ".artwork img, .cover-art img, [itemprop='image']", attribute: "src" },
      { id: "episodeCount", name: "Episode/Track Count", type: "number", selectorStrategy: "css", selector: ".episode-count, .track-count", transform: "number" },
      { id: "category", name: "Category/Genre", type: "text", selectorStrategy: "css", selector: ".category, .genre, [itemprop='genre']" },
      { id: "rating", name: "Rating", type: "number", selectorStrategy: "css", selector: "[itemprop='ratingValue']", attribute: "content", transform: "number" },
      { id: "latestEpisode", name: "Latest Release", type: "date", selectorStrategy: "css", selector: ".latest-episode time, .release-date", attribute: "datetime" },
    ],
    sampleOutput: { showName: "The AI Podcast", creator: "NVIDIA", episodeCount: 250, category: "Technology", rating: 4.8 },
    isBuiltin: true,
  },

  // ── RSS Feed ────────────────────────────────────────────────────────────
  {
    id: "rss-feed",
    name: "RSS / Atom Feeds",
    description: "Subscribe to and collect articles from RSS or Atom feeds with optional full-content fetch.",
    category: "Feeds",
    icon: "Rss",
    config: {
      sourceType: "rss",
      mode: "http",
      output: { format: "markdown", extractImages: true },
      autoTag: { enabled: true, detectSentiment: true, classifyTopics: true },
    },
    fields: [
      { id: "title", name: "Article Title", type: "text", selectorStrategy: "css", selector: "title", required: true },
      { id: "link", name: "Link", type: "url", selectorStrategy: "css", selector: "link" },
      { id: "description", name: "Description", type: "text", selectorStrategy: "css", selector: "description" },
      { id: "pubDate", name: "Published Date", type: "date", selectorStrategy: "css", selector: "pubDate" },
      { id: "author", name: "Author", type: "text", selectorStrategy: "css", selector: "author, dc\\:creator" },
    ],
    sampleOutput: { title: "New AI Breakthrough", link: "https://example.com/article", pubDate: "2026-02-22" },
    isBuiltin: true,
  },
];

// ── Template lookup ─────────────────────────────────────────────────────────

export function getTemplate(id: string): ScrapingTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: string): ScrapingTemplate[] {
  return BUILTIN_TEMPLATES.filter(
    (t) => t.category.toLowerCase() === category.toLowerCase(),
  );
}

export function listTemplates(): ScrapingTemplate[] {
  return [...BUILTIN_TEMPLATES];
}
