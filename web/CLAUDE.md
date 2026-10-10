This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Overview

MeshSketch is a web-based OpenGL mesh editor that allows users to draw polygons in 2D space and export them as C++
OpenGL code. The application uses OpenGL's Normalized Device Coordinates (NDC) where x and y range from -1 to +1.

High-Level Architecture

Three-File Web Application:

1. index.html - Complete user interface containing:
   - Main canvas area with OpenGL NDC coordinate system
   - Right sidebar for tools and object management
   - Export panel for C++ code generation
   - Viewport controls, theme switching
   - Real-time statistics display
2. app.js - Core JavaScript application logic including:
   - Polygon editing with Select and Polygon modes
   - Ear-clipping triangulation algorithm
   - Polygon validation (boundary, collinearity, self-intersection)
   - Complete history/undo/redo system
   - C++ code generation (8-float vertex layout: xyz + RGB + UV)
   - File download/export functionality
   - Complex UI event handling and state management
3. styles.css - Complete UI styling with:
   - Light/dark theme support
   - Modern component design inspired by shadcn/ui
   - Responsive layout for desktop and mobile
   - Grid and snapping visual feedback

Key Technical Implementation

OpenGL Integration:

- Uses Canvas 2D API for rendering but generates C++ OpenGL code
- 8-float vertex layout: position (xyz) + color (RGB) + texture coordinates (UV)
- Export includes both vertices array and indices array
- NDC coordinate system consistent with OpenGL specifications

Advanced Polygon Operations:

- Triangulation: Ear-clipping algorithm for both convex and concave polygons
- Validation: Automatic checks for collinearity, self-intersection, boundary limits
- Vertex Editing: Real-time coordinate modification with validation
- Layer Management: Bring-forward/bring-backward operations

User Experience Features:

- Canvas-relative coordinate conversion
- Viewport resizing with aspect ratio preservation
- Multiple export formats (C++, JSON, PNG artwork)
- Keyboard shortcuts for power users
- History system with 80-state stack

Development Workflow

Quick Commands:

- Run the application: Open index.html in a modern web browser
- Inspect and debug: Use browser developer tools (F12)
- Code editing: All modifications can be made directly to the three files

Code Structure Notes:

- All state management is in app.js
- UI events are mapped directly to application functions
- No external dependencies - pure JavaScript, HTML, and CSS
- Project can run entirely locally in the browser

Notable Implementation Patterns:

- Uses $() helper function for DOM element access
- Immutable-style operations with history snapshots
- Grid snapping at 0.05 increments
- Comprehensive error handling for user feedback

Common Tasks

For Future Development:

1. Adding Export Formats:
   - Understand existing export patterns in app.js
   - Follow same download, blob, and URL creation pattern
   - Match the existing UI button structure
2. Improving Polygon Operations:
   - Study the triangulation algorithm in triangulate() function
   - Understand the validation system in validPolygon()
   - Note the coordinate rounding system for precision control
3. Enhancing UI:
   - Examine the component patterns in styles.css
   - Understand the theme switching mechanism
   - Note the responsive breakpoint strategy
4. Debugging Issues:
   - The application has extensive error handling
   - User feedback is displayed via setStatus() system
   - Console debugging of the shapes array provides visibility into state

Important Considerations:

- The application uses client-side only storage and computation
- All polygon data remains in memory during the session
- No backend server is required
- Exported C++ code requires separate OpenGL setup
- The application maintains a consistent 60fps rendering for smooth interaction

This project demonstrates a complete, self-contained web application that combines sophisticated geometry algorithms
with an intuitive user interface, providing a unique tool for creating OpenGL meshes through direct manipulation.
