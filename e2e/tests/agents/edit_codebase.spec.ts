import {test, expect} from '@playwright/test';
import {ChatPage} from '../utils/page_object';

// Need to skip this because search tool is not supported in test
// so there's no way to trigger this right now.
test.skip('edit codebase', async ({page}) => {
  const chatPage = await new ChatPage(page).setup();
  await chatPage.fillInChatInput('[test=(tool-call:edit_codebase)]');
  await chatPage.submitChat();

  await expect(chatPage.locateAssistantMessage()).toMatchAriaSnapshot(`
    - text: Thinking about what to do next...
    - button
    - text: Editing codebase
    - button
    - paragraph: final response (after editing codebase)
    - text: edit_codebase/existing.ts Copy content_copy Apply play_arrow
    - code: // replace file
  `);
});
