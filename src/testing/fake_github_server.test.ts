// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  handleRepo,
  handleRepoCollaborators,
  handleResetRepos,
  handleUserRepos,
  handleCreateDeployKey,
  handleListDeployKeys,
  handleGitPush,
  handleGetPushEvents,
} from "../../testing/fake-llm-server/githubHandler";

type Request = Parameters<typeof handleUserRepos>[0];
type Response = Parameters<typeof handleUserRepos>[1];

function callHandler(
  handler: (req: Request, res: Response) => unknown,
  request: Partial<Request> = {},
) {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  };
  handler(
    {
      method: "GET",
      headers: { authorization: "Bearer fake_access_token_12345" },
      params: {},
      query: {},
      ...request,
    } as Request,
    response as unknown as Response,
  );
  return response;
}

afterEach(() => callHandler(handleResetRepos));

describe("fake GitHub repository reset", () => {
  it("drops a push body that finishes after its repository generation was reset", () => {
    const request = Object.assign(new EventEmitter(), {
      method: "POST",
      url: "/github/git/testuser/test-repo-1.git/git-receive-pack",
      headers: {},
    });
    const response = { status: vi.fn().mockReturnThis(), end: vi.fn() };
    handleGitPush(
      request as unknown as Request,
      response as unknown as Response,
    );
    request.emit(
      "data",
      Buffer.from(`${"0".repeat(40)} ${"a".repeat(40)} refs/heads/main\n`),
    );
    callHandler(handleResetRepos);
    request.emit("end");
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.end).toHaveBeenCalledOnce();
    expect(callHandler(handleGetPushEvents).json).toHaveBeenCalledWith([]);
  });

  it("clears deploy keys so a recreated repo can register the same key", () => {
    const params = { owner: "testuser", repo: "test-repo-1" };
    const request = {
      method: "POST",
      params,
      body: { key: "ssh-ed25519 AAAA test", title: "Deploy" },
    };
    expect(
      callHandler(handleCreateDeployKey, request).status,
    ).toHaveBeenCalledWith(201);
    expect(
      callHandler(handleCreateDeployKey, request).status,
    ).toHaveBeenCalledWith(422);
    callHandler(handleResetRepos);
    expect(
      callHandler(handleListDeployKeys, { params }).json,
    ).toHaveBeenCalledWith([]);
    expect(
      callHandler(handleCreateDeployKey, request).status,
    ).toHaveBeenCalledWith(201);
  });

  it("makes a created repository name available again while preserving seed repos", () => {
    const initialRepos = structuredClone(
      callHandler(handleUserRepos).json.mock.calls[0][0],
    );
    const createRequest = {
      method: "POST",
      body: { name: "guided-vercel", private: true },
    };
    expect(
      callHandler(handleUserRepos, createRequest).status,
    ).toHaveBeenCalledWith(201);
    expect(
      callHandler(handleUserRepos, createRequest).status,
    ).toHaveBeenCalledWith(422);

    callHandler(handleResetRepos);

    expect(
      callHandler(handleRepo, {
        params: { owner: "testuser", repo: "guided-vercel" },
      }).status,
    ).toHaveBeenCalledWith(404);
    expect(callHandler(handleUserRepos).json).toHaveBeenCalledWith(
      initialRepos,
    );
    expect(
      callHandler(handleUserRepos, createRequest).status,
    ).toHaveBeenCalledWith(201);
  });

  it("clears collaborators added to a seeded repository", () => {
    const params = { owner: "testuser", repo: "test-repo-1" };
    callHandler(handleRepoCollaborators, {
      method: "PUT",
      params: { ...params, username: "collaborator" },
    });
    expect(
      callHandler(handleRepoCollaborators, { params }).json,
    ).toHaveBeenCalledWith([
      expect.objectContaining({ login: "collaborator" }),
    ]);

    callHandler(handleResetRepos);

    expect(
      callHandler(handleRepoCollaborators, { params }).json,
    ).toHaveBeenCalledWith([]);
  });
});
