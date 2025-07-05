# Contributing

Dyad is still a very early-stage project, thus the codebase is rapidly changing.

Before opening a pull request, please open an issue and discuss whether the change makes sense in Dyad. Ensuring a cohesive user experience sometimes means we can't include every possible feature or we need to consider the long-term design of how we want to support a feature area.

## More than code contributions

Something that I really appreciate are all the non-code contributions, such as reporting bugs, writing feature requests and participating on [Dyad's sub-reddit](https://www.reddit.com/r/dyadbuilders).

## Development

Dyad is an Electron app.

**Install dependencies:**

```sh
npm install
```

**Run locally:**

```sh
npm start
```

## Testing

**Unit tests:**

```sh
npm run test
```

**E2E tests:**

```sh
# Run all e2e tests (builds the app first)
npm run pre:e2e && npm run e2e

# Run a specific shard (useful for debugging or parallel development)
npm run e2e:shard 1/4

# Run sharded tests locally
npm run pre:e2e
npm run e2e:shard 1/4 &
npm run e2e:shard 2/4 &
npm run e2e:shard 3/4 &
npm run e2e:shard 4/4 &
```

The CI system automatically runs e2e tests in 4 parallel shards for faster execution and then merges the results.
