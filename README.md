# Hi

hehe

## Cozy Cube World

A cozy low-poly 3D scene with one heavy stone cube, a grassy baseplate, a storybook tree, soft lighting, and iPad touch controls. Moving the cube dents and scuffs the ground, while dust, debris, impact rings, squash, and camera shake make it feel weighty.

All major surface textures are AI-generated and live in `public/textures`.

### Run locally

```bash
npm install
npm run dev
```

Open the preview in an iPad browser. Drag the joystick on the left to move the cube; tap **JUMP** on the right to make it land heavily.

### GitHub Pages

The site uses relative asset paths, so the built `dist` folder works at either a repository subpath or a custom domain. A GitHub Actions workflow builds the site and deploys `dist` whenever `main` changes.

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. After the workflow finishes, open the Pages URL shown in the deployment environment. For a manual upload, publish the contents of `dist` rather than the repository source files.
