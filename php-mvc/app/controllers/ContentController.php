<?php

require_once __DIR__ . '/../core/BaseController.php';

class ContentController extends BaseController
{
    public function __construct($db)
    {
        parent::__construct($db);
    }

    public function index()
    {
        $projectData = $this->ensureProjectSelected();
        $projects = $projectData['projects'];
        $active_project_id = $projectData['active_project_id'];

        require_once __DIR__ . '/../views/content.php';
    }
}
