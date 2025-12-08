I will intentionally add multiple errors to test the Fix All Errors button

<dyad-write path="src/pages/Index.tsx" description="intentionally add first error">
// Update this page (the content is just a fallback if you fail to update the page)

import { MadeWithDyad } from "@/components/made-with-dyad";

const Index = () => {
throw new Error("First error in Index");
return (

<div className="min-h-screen flex items-center justify-center bg-gray-100">
<div className="text-center">
<h1 className="text-4xl font-bold mb-4">Welcome to Your Blank App</h1>
<p className="text-xl text-gray-600">
Start building your amazing project here!
</p>
</div>
<MadeWithDyad />
</div>
);
};

export default Index;
</dyad-write>

<dyad-output type="error" message="First error in Index">
Error: First error in Index
    at Index (http://localhost:5173/src/pages/Index.tsx:6:7)
</dyad-output>

<dyad-write path="src/components/ErrorComponent.tsx" description="intentionally add second error">
const ErrorComponent = () => {
  throw new Error("Second error in ErrorComponent");
  return <div>This will never render</div>;
};

export default ErrorComponent;
</dyad-write>

<dyad-output type="error" message="Second error in ErrorComponent">
Error: Second error in ErrorComponent
    at ErrorComponent (http://localhost:5173/src/components/ErrorComponent.tsx:2:9)
</dyad-output>

<dyad-write path="src/utils/helper.ts" description="intentionally add third error">
export const brokenHelper = () => {
  throw new Error("Third error in helper");
};
</dyad-write>

<dyad-output type="error" message="Third error in helper">
Error: Third error in helper
    at brokenHelper (http://localhost:5173/src/utils/helper.ts:2:9)
</dyad-output>