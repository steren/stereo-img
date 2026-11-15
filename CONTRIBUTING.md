# How to Contribute

We'd love to accept your patches and contributions to this project. There are
just a few small guidelines you need to follow.

## Develop locally

There is no compilation step.

### Starting a local development server

Install dependencies with `npm install`.

Run the local web server with `npm start`.

### Running tests

Run unit tests with `npm test`.
Run integration tests with `npm run test:integration`. They run in a headless Chrome.

## Adding a camera

Some cameras and lenses need special handling, because their pictures do not say enough about themselves: the layout of the two eyes, the angle of view, the position of fisheye circles.

What is known about them is in [`parsers/stereo-parser/cameras.js`](parsers/stereo-parser/cameras.js). To support a new one, add an entry to that list, a test in `tests/unit/cameras.test.js`, and a line in the table of supported cameras of the README.

## Publishing to npm

To update the [npm package](https://www.npmjs.com/package/stereo-img)

Run the following:

* `npm version minor`
* `git push --follow-tags`

Then create a GitHub release for the tag you just pushed, either from the
[releases page](https://github.com/steren/stereo-img/releases/new) or with:

* `gh release create "v$(node -p "require('./package.json').version")" --generate-notes`

Creating the release is what triggers the
[GitHub Action](https://github.com/steren/stereo-img/blob/main/.github/workflows/npm-publish.yml)
that publishes to npm. Pushing the tag on its own does not publish anything.

### Authentication

The workflow authenticates to npm with
[trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so there
is no npm token stored in this repository and nothing to rotate. The trust
relationship is configured once on npmjs.com, under the package's
*Settings -> Trusted publisher*:

* Publisher: GitHub Actions
* Organization or user: `steren`
* Repository: `stereo-img`
* Workflow filename: `npm-publish.yml`
* Environment: (leave empty)

As a side effect, published versions also carry
[provenance attestations](https://docs.npmjs.com/generating-provenance-statements).

## Code Reviews

All submissions, including submissions by project members, require review. We
use GitHub pull requests for this purpose. Consult
[GitHub Help](https://help.github.com/articles/about-pull-requests/) for more
information on using pull requests.

