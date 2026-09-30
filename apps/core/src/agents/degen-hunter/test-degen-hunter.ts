import { runDegenHunter } from './index.js';

// Note: The above import assumes we are running from the dist directory.
// For testing, we'll adjust the path when we run the compiled version.
// Alternatively, we can run the test directly with ts-node, but we don't have it.
// We'll instead create a separate test script that will be compiled and run.

// Since we are going to compile this file, we need to use relative paths to the compiled output.
// However, it's easier to just test the compiled index.js directly with a node script that requires it.
// We'll create a different approach: we'll run the agent directly using the built index.js.

// Let's just export a function that we can call, and then we'll create a separate runner.

export async function testRun() {
  try {
    await runDegenHunter();
    console.log('Test completed successfully');
    return true;
  } catch (err) {
    console.error('Test failed:', err);
    return false;
  }
}

// Run the test when this file is executed directly
if (require.main === module) {
  testRun().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
}
