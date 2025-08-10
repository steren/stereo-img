# How to Contribute

We'd love to accept your patches and contributions to this project. There are
just a few small guidelines you need to follow.

## Develop locally

Thre is no compilation step.

### Starting a local development server

Install dependencies with `npm install`.

Run the local web server with `npm start`.

### Starting a local development server

Run tests with `npm test`.

## Publishing to npm

To update the [npm package](https://www.npmjs.com/package/stereo-img)

Run the following:

* `npm test`
* `npm version minor`
* `git push --follow-tags`

Then a [GitHub Action](https://github.com/steren/stereo-img/blob/main/.github/workflows/release.yml) automatically publishes to npm.

## Contributor License Agreement

Contributions to this project must be accompanied by a Contributor License
Agreement (CLA). You (or your employer) retain the copyright to your
contribution; this simply gives us permission to use and redistribute your
contributions as part of the project. Head over to
<https://cla.developers.google.com/> to see your current agreements on file or
to sign a new one.

You generally only need to submit a CLA once, so if you've already submitted one
(even if it was for a different project), you probably don't need to do it
again.

## Code Reviews

All submissions, including submissions by project members, require review. We
use GitHub pull requests for this purpose. Consult
[GitHub Help](https://help.github.com/articles/about-pull-requests/) for more
information on using pull requests.

## Community Guidelines

This project follows
[Google's Open Source Community Guidelines](https://opensource.google/conduct/).
